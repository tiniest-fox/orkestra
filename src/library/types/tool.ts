// types: the shape of a `.orkestra/tools/*.sh` declaration — a command a sandbox installs
// on its first call rather than one its template carries. The script owns its download:
// the engine reads only the header, and hands the script the directory to install into.

export interface SandboxTool {
  /** Derived from the filename: `rclone.sh` -> `rclone`. Also the command a call names. */
  readonly name: string
  readonly description: string
  /**
   * Names the directory the install lands in, so changing it installs again. A string as
   * written, since YAML would read `1.70` as the number `1.7`.
   */
  readonly version: string
  /** Absolute, as the library read it — the same path in a sandbox, which is sent it. */
  readonly path: string
}
