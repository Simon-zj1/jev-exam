import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { resolveDecisionEngine } from "@/lib/engine";
import { resolveGenerationProvider } from "@/lib/generator";
import { checkQuota } from "@/lib/quota";
import { readByok, summarizeByok } from "@/lib/services/byok";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const byok = readByok(user);
    const quota = await checkQuota(user.id, {});
    const engine = byok?.judge?.apiKey
      ? "byok"
      : process.env.TYPESAFE_API_KEY
        ? "typesafe"
        : process.env.PLATFORM_LLM_API_KEY
          ? "llm-judge"
          : "offline-lexical";

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      byok: summarizeByok(byok),
      quota: { usage: quota.usage, limits: quota.limits },
      engine,
      generator: (() => {
        const selection = resolveGenerationProvider({ byok });
        return { id: selection.provider.id, mode: selection.mode };
      })(),
      decisionEngine: (() => {
        const selection = resolveDecisionEngine({ byok });
        return { id: selection.engine.id, mode: selection.mode };
      })(),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
