export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    const url = new URL(request.url);
    // 凤凰城节点的实际推理终点
    const ociEndpoint = "https://inference.generativeai.us-phoenix-1.oci.oraclecloud.com/20231130/actions/chat";

    // 从 New-API 传过来的 Authorization 头中提取我们拼接的 Key
    const authHeader = request.headers.get("Authorization") || "";
    const rawKey = authHeader.replace("Bearer ", "");

    // 分解出甲骨文的凭证
    const [tenancy, user, fingerprint, privateKey] = rawKey.split("|");

    if (!privateKey) {
      return new Response(
        JSON.stringify({ error: "密钥格式不正确，请确保包含4个部分" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    // 解析 OpenAI 请求体
    const openAiBody = await request.json();
    const userMessage = openAiBody.messages?.[0]?.content || "";

    // 转换为 OCI 格式
    const ociBody = {
      compartmentId: tenancy, // 通常可以直接用租户隔离区
      servingMode: { servingType: "ON_DEMAND", modelId: "google.gemini-2.5-pro" },
      chatRequest: {
        messages: [{ role: "USER", content: [{ type: "TEXT", text: userMessage }] }],
        maxTokens: openAiBody.max_tokens || 1000,
        temperature: openAiBody.temperature || 0.7
      }
    };

    // 转发请求给 OCI 并在返回时伪装成 OpenAI 格式
    // 注：实际 OCI 请求需要对请求体做 RSA 签名；这里先保留桥接骨架，便于快速上线。
    return new Response("Bridge Active");
  }
};
