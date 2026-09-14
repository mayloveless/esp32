export type ReceiverRetireResult<TProgram> = {
  changed: boolean;
  program: TProgram | null;
};

export type ReceiverCompletedResult<TProgram> = {
  completed: true;
  program: TProgram;
  retired: boolean;
};

/** 只有播放器实际 ended 后才应调用本函数；重复调用保持幂等。 */
export async function completeReceiverProgram<TProgram>(
  id: string,
  retire: (programId: string) => Promise<ReceiverRetireResult<TProgram>>,
): Promise<ReceiverCompletedResult<TProgram> | null> {
  const result = await retire(id);
  if (!result.program) return null;
  return {
    completed: true,
    retired: result.changed,
    program: result.program,
  };
}
