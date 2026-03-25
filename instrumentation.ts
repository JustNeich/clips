export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const [{ scheduleChannelPublicationProcessing }] = await Promise.all([
    import("./lib/channel-publication-runtime")
  ]);
  scheduleChannelPublicationProcessing();
}
