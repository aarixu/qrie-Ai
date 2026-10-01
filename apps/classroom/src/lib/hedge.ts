/**
 * ONE CALL, AND A SECOND ONE IF THE FIRST IS SLOW.
 *
 * Vertex answers most calls in a few seconds and a few in half a minute: the
 * class's judge, timed through the live relay on 2026-10-02, came back in
 * 1.9-3.9 s six times out of eight and in 30.6 s and 52.8 s the other two (the
 * relay's own `model` timing). A student who answered is not kept waiting on
 * that tail: when the first call has not answered by `afterMs`, an identical
 * second one goes, and whichever answers first is the answer. A first call
 * that FAILS before then is asked again at once.
 *
 * Two calls at most. The result fails only when every call made has failed,
 * with the last failure. The slower call is not cancelled; its answer is
 * ignored.
 */
export function hedged<T>(call: () => Promise<T>, afterMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let made = 0;
    let failed = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const start = (): void => {
      made += 1;
      call().then(
        (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (done) return;
          failed += 1;
          if (made < 2) {
            clearTimeout(timer);
            start();
          } else if (failed === made) {
            done = true;
            reject(error);
          }
        },
      );
    };

    start();
    timer = setTimeout(() => {
      if (!done && made < 2) start();
    }, afterMs);
  });
}
