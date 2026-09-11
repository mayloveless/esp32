import type { RadioProgram } from "./types";

export type SynthesisOperation = "generate_audio" | "regenerate_audio";

export function getSynthesisOperation(
  program: Pick<RadioProgram, "content" | "status">,
): SynthesisOperation | null {
  if (!Array.isArray(program.content.segments)) return null;
  if (program.status === "ready") return "regenerate_audio";
  if (program.status === "queued" || program.status === "failed")
    return "generate_audio";
  return null;
}
