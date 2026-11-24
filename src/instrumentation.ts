/** Runs once when each server process starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SKIP_ENV_VALIDATION) return;
  const { listenForEvents } = await import("~/server/realtime");
  const { copyDiskFiles } = await import("~/server/storage");
  void listenForEvents();
  // Uploads moved from the /data volume into Postgres; this copies any left on the volume.
  copyDiskFiles()
    .then((n) => n && console.log(`[storage] copied ${n} files from the upload volume into the database`))
    .catch((e: unknown) => console.error("[storage] copying files from the upload volume failed", e));
}
