import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { detectProvider } from "@/lib/llm/catalog";
import { OpenAICompatibleProvider } from "@/lib/llm/provider";

/**
 * 「测试连接」：用户粘完 Key 之后，先确认它真的能用，再让他保存。
 *
 * 对不懂技术的用户来说，这一步比任何文档都重要——否则他们只会在"出题失败"时
 * 拿到一个英文报错。这里用一次极短的请求验证：地址、Key、模型名三件事。
 */
export async function POST(request: NextRequest) {
  try {
    await requireUserFromRequest(request);
    const body = (await request.json()) as {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };

    const apiKey = body.apiKey?.trim();
    if (!apiKey) throw new ValidationError("请先粘贴 API Key");

    const profile = detectProvider(apiKey, body.provider);
    const baseUrl = (body.baseUrl?.trim() || profile.baseUrl).replace(/\/+$/, "");
    const model = body.model?.trim() || profile.defaultModel;
    if (!baseUrl) throw new ValidationError("请填写接口地址（Base URL）");
    if (!model) throw new ValidationError("请填写模型名");

    const provider = new OpenAICompatibleProvider({
      apiKey,
      baseUrl,
      model,
      timeoutMs: 20_000,
    });

    const startedAt = Date.now();
    const response = await provider.complete({
      system: "你是一个连接测试助手，只回复两个字：可用。",
      user: "请回复：可用",
      temperature: 0,
      maxTokens: 16,
    });

    return NextResponse.json({
      ok: true,
      provider: profile.kind,
      providerLabel: profile.label,
      baseUrl,
      requestedModel: model,
      actualModel: response.model,
      latencyMs: Date.now() - startedAt,
      sample: response.text.trim().slice(0, 40),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    const message = (body as { error?: string }).error ?? "连接失败";
    return NextResponse.json(
      {
        ok: false,
        error: explain(message),
        raw: message.slice(0, 300),
      },
      { status: status === 200 ? 400 : status },
    );
  }
}

/** 把常见英文报错翻译成用户能照做的中文提示。 */
function explain(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("401") || text.includes("invalid api key") || text.includes("authentication")) {
    return "API Key 无效或已过期：请回到服务商控制台重新复制一次完整 Key。";
  }
  if (text.includes("404") || text.includes("model not found") || text.includes("does not exist")) {
    return "模型名不对：请按服务商文档填写可用模型名（例如 deepseek-chat、glm-4.6、qwen-plus）。";
  }
  if (text.includes("429") || text.includes("rate limit")) {
    return "请求被限流或额度不足：请稍后重试，或检查账户余额。";
  }
  if (text.includes("enotfound") || text.includes("fetch failed") || text.includes("timeout")) {
    return "网络不可达：请确认接口地址是否正确、这台服务器能不能访问该服务商。";
  }
  if (text.includes("403")) {
    return "被拒绝：Key 可能没有该模型的权限，或账户未实名/未开通。";
  }
  return `连接失败：${message.slice(0, 160)}`;
}
