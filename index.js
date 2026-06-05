export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return json({ ok: true, service: "oci-openai-worker" }, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        validateBearer(request, env);
        const modelId = env.OCI_MODEL_ID || "google.gemini-2.5-pro";
        return json(
          {
            object: "list",
            data: [
              {
                id: modelId,
                object: "model",
                owned_by: "oci"
              }
            ]
          },
          200,
          corsHeaders
        );
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions" || url.pathname === "/")
      ) {
        validateBearer(request, env);

        const openaiBody = await request.json();
        const model = openaiBody.model || env.OCI_MODEL_ID || "google.gemini-2.5-pro";
        const maxTokens = openaiBody.max_tokens ?? 1024;
        const temperature = openaiBody.temperature ?? 0.7;
        const messages = Array.isArray(openaiBody.messages) ? openaiBody.messages : [];
        const promptText = normalizeMessages(messages);

        const region = env.OCI_REGION || "us-phoenix-1";
        const host = `inference.generativeai.${region}.oci.oraclecloud.com`;
        const path = "/20231130/actions/chat";
        const endpoint = `https://${host}${path}`;
        const compartmentId = env.OCI_COMPARTMENT_ID || env.OCI_TENANCY;

        const ociBody = {
          compartmentId,
          servingMode: {
            servingType: "ON_DEMAND",
            modelId: model
          },
          chatRequest: {
            messages: [
              {
                role: "USER",
                content: [
                  {
                    type: "TEXT",
                    text: promptText || "你好"
                  }
                ]
              }
            ],
            maxTokens,
            temperature
          }
        };

        const bodyText = JSON.stringify(ociBody);
        const bodyBytes = new TextEncoder().encode(bodyText);
        const contentLength = String(bodyBytes.byteLength);
        const xContentSha256 = await sha256Base64(bodyBytes);
        const xDate = new Date().toUTCString();

        const signingString = [
          `(request-target): post ${path}`,
          `host: ${host}`,
          `x-date: ${xDate}`,
          `content-type: application/json`,
          `content-length: ${contentLength}`,
          `x-content-sha256: ${xContentSha256}`
        ].join("\n");

        const signature = await signWithPrivateKey(env.OCI_PRIVATE_KEY, signingString);
        const keyId = `${env.OCI_TENANCY}/${env.OCI_USER}/${env.OCI_FINGERPRINT}`;
        const authorization = [
          'Signature version="1"',
          `keyId="${keyId}"`,
          'algorithm="rsa-sha256"',
          'headers="(request-target) host x-date content-type content-length x-content-sha256"',
          `signature="${signature}"`
        ].join(",");

        const upstreamResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            host,
            "x-date": xDate,
            "content-type": "application/json",
            "content-length": contentLength,
            "x-content-sha256": xContentSha256,
            authorization,
            accept: "application/json"
          },
          body: bodyText
        });

        const rawText = await upstreamResponse.text();
        let ociData;
        try {
          ociData = JSON.parse(rawText);
        } catch {
          ociData = { raw: rawText };
        }

        if (!upstreamResponse.ok) {
          return json(
            {
              error: {
                message: "OCI request failed",
                type: "upstream_error",
                status: upstreamResponse.status,
                details: ociData
              }
            },
            502,
            corsHeaders
          );
        }

        const replyText = extractOciText(ociData);
        const openaiResponse = {
          id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: replyText
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        };

        return json(openaiResponse, 200, corsHeaders);
      }

      return json({ error: "Not Found" }, 404, corsHeaders);
    } catch (error) {
      const status = error?.status || 500;
      return json(
        {
          error: {
            message: error?.message || String(error),
            type: error?.type || "internal_error"
          }
        },
        status,
        corsHeaders
      );
    }
  }
};

function validateBearer(request, env) {
  const expected = env.WORKER_API_KEY;
  if (!expected) return;

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token || token !== expected) {
    const error = new Error("Unauthorized");
    error.status = 401;
    error.type = "auth_error";
    throw error;
  }
}

function normalizeMessages(messages) {
  return messages
    .map((message) => {
      const role = message?.role || "user";
      const content = extractOpenAIContent(message?.content);
      return `${role}: ${content}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractOpenAIContent(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        if (part?.type === "input_text") return part.text || "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractOciText(data) {
  const candidates = [
    data?.chatResponse?.choices?.[0]?.message?.content?.[0]?.text,
    data?.chatResponse?.message?.content?.[0]?.text,
    data?.chatResponse?.text,
    data?.choices?.[0]?.message?.content,
    data?.output?.text,
    data?.data?.text,
    data?.message
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }

  return JSON.stringify(data);
}

async function sha256Base64(inputBytes) {
  const digest = await crypto.subtle.digest("SHA-256", inputBytes);
  return arrayBufferToBase64(digest);
}

async function signWithPrivateKey(pem, signingString) {
  if (!pem) {
    const error = new Error("Missing OCI_PRIVATE_KEY secret");
    error.status = 500;
    error.type = "config_error";
    throw error;
  }

  const privateKey = await importPrivateKey(pem);
  const data = new TextEncoder().encode(signingString);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    data
  );
  return arrayBufferToBase64(signature);
}

async function importPrivateKey(pem) {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binary.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    }
  });
}
