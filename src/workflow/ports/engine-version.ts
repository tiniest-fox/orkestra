import { Context } from "effect"

/**
 * The version of the engine this process is — what every turn event is stamped with at
 * the append, so the log says which shipped roles a turn ran under.
 *
 * A boot fact handed in rather than read here, because the version is read off the
 * package's own `package.json` in `app/packaged.ts` and the workflow may not import the
 * app layer. A test gives it any string.
 */
export class EngineVersion extends Context.Tag("workflow/EngineVersion")<EngineVersion, string>() {}
