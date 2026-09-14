import "server-only";
import { retireProgram } from "../program/service.ts";
import { completeReceiverProgram as completeReceiverProgramCore } from "./completed-core.ts";

export type { ReceiverCompletedResult } from "./completed-core.ts";

/** 只有播放器实际 ended 后才应调用本函数；重复调用保持幂等。 */
export async function completeReceiverProgram(
  id: string,
) {
  return completeReceiverProgramCore(id, retireProgram);
}
