import { normalizeEmail } from "@/lib/auth/email";
import { getStore } from "@/lib/db";
import type { UserRecord } from "@/lib/db/types";
import { ValidationError } from "@/lib/errors";

/**
 * 删除账号（不可恢复）。
 *
 * 要求用户输入自己的邮箱确认，不是多余步骤：这个动作会连带删掉材料、试卷、作答、
 * 判定、掌握度与复习排期，误触的代价无法挽回。
 * 另外 App Store 明确要求提供账号删除入口，这一步也是上架前置条件。
 */
export async function deleteAccountForUser(user: UserRecord, confirmation: string): Promise<void> {
  if (normalizeEmail(confirmation) !== normalizeEmail(user.email)) {
    throw new ValidationError("输入的邮箱与当前账号不一致，删除已取消。");
  }
  await getStore().deleteUserData(user.id);
}
