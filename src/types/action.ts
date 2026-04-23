export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ success: true, data });

export const fail = <T = never>(error: string): ActionResult<T> => ({
  success: false,
  error,
});
