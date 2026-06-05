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

      if (request.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        return json(
          {
            object: "list",
            data: getSupportedModels(env).map((id) => ({
              id,
              object: "model",
              owned_by: "oci"
            }))
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
        const model = openaiBody.model || env.OCI_MODEL_ID || DEFAULT_MODELS[0];
        const maxTokens = openaiBody.max_tokens ?? 1024;
        const temperature = openaiBody.temperature ?? 0.7;
        const messages = Array.isArray(openaiBody.messages) ? openaiBody.messages : [];

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
          chatRequest: buildChatRequest(model, messages, { maxTokens, temperature })
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
                details: ociData,
                requested_model: model,
                request_preview: ociBody
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

const DEFAULT_MODELS = [
  "cohere.command-a-03-2025 v1.0",
  "cohere.command-a-vision v1.0",
  "cohere.command-latest",
  "cohere.command-plus-latest",
  "cohere.command-r-08-2024 v2.0",
  "cohere.command-r-08-2024 v1.7",
  "cohere.command-r-plus-08-2024 v2.0",
  "cohere.command-r-plus-08-2024 v1.6",
  "google.gemini-2.5-flash",
  "google.gemini-2.5-flash-lite",
  "google.gemini-2.5-pro",
  "meta.llama-3.1-405b-instruct",
  "meta.llama-3.2-90b-vision-instruct",
  "meta.llama-3.3-70b-instruct",
  "meta.llama-4-maverick-17b-128e-instruct-fp8",
  "meta.llama-4-scout-17b-16e-instruct",
  "openai.gpt-oss-120b",
  "openai.gpt-oss-20b",
  "xai.grok-3",
  "xai.grok-3-fast",
  "xai.grok-3-mini",
  "xai.grok-3-mini-fast",
  "xai.grok-4",
  "xai.grok-4-1-fast-non-reasoning",
  "xai.grok-4-1-fast-reasoning",
  "xai.grok-4-fast-non-reasoning",
  "xai.grok-4-fast-reasoning",
  "xai.grok-4.20-0309-non-reasoning",
  "xai.grok-4.20-0309-reasoning",
  "xai.grok-4.20-non-reasoning",
  "xai.grok-4.20-reasoning",
  "xai.grok-4.3",
  "xai.grok-code-fast-1",
  "xai.grok-voice-agent"
];

function buildChatRequest(model, messages, options) {
  // Gemini / Llama / Grok / GPT-OSS families in OCI generally use GENERIC chat format.
  return buildGenericChatRequest(messages, options);
}

function buildGenericChatRequest(messages, options) {
  const normalizedMessages = (messages.length ? messages : [{ role: "user", content: "你好" }])
    .map(toGenericMessage)
    .filter(Boolean);

  return {
    apiFormat: "GENERIC",
    messages: normalizedMessages,
    maxTokens: options.maxTokens,
    temperature: options.temperature
  };
}

function toGenericMessage(message) {
  const content = extractOpenAIContent(message?.content);
  if (!content) return null;

  return {
    role: mapRole(message?.role),
    content: [
      {
        type: "TEXT",
        text: content
      }
    ]
  };
}

function mapRole(role) {
  switch ((role || "user").toLowerCase()) {
    case "assistant":
      return "ASSISTANT";
    case "system":
      return "SYSTEM";
    case "developer":
      return "DEVELOPER";
    case "tool":
      return "TOOL";
    case "user":
    default:
      return "USER";
  }
}

function getSupportedModels(env) {
  const extra = env.OCI_MODELS || env.OPENAI_MODELS || "";
  if (!extra.trim()) return DEFAULT_MODELS;

  const configured = extra
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_MODELS;
}

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
