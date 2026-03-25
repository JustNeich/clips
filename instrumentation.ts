export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const dynamicImport = new Function("specifier", "return import(specifier);") as <
    TModule = { scheduleChannelPublicationProcessing: () => void }
  >(
    specifier: string
  ) => Promise<TModule>;

  const { scheduleChannelPublicationProcessing } = await dynamicImport(
    "./lib/channel-publication-runtime"
  );
  scheduleChannelPublicationProcessing();
}
