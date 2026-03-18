function printUsage(): void {
  process.stdout.write(
    [
      "Stage 2 worker refresh CLI is deprecated.",
      "The current Stage 2 runtime now resolves a global examples corpus in-app",
      "and no longer uses competitor/hot-pool refresh jobs as the primary path.",
      "",
      "No action was performed."
    ].join("\n")
  );
}

printUsage();
