/** @readmeops/core public API. Zero runtime dependencies; runs in Node and browsers. */
export { version } from "./version.ts";

export type * from "./model/types.ts";
export { emptyProfile } from "./model/types.ts";

export { collectProfile } from "./collect.ts";
export type { CollectOptions } from "./collect.ts";
export { createGitHubClient, GitHubApiError } from "./sources/github/client.ts";
export type { GitHubClient, FetchLike } from "./sources/github/client.ts";
export { parseFeed, collectPosts } from "./sources/rss.ts";
export { assertPublicSafe, countPrivate, PrivacyError } from "./privacy.ts";

export { buildView, CARD_IDS } from "./view.ts";
export type { View, CardId } from "./view.ts";
export { LOOKS, LOOK_IDS, SCHEMES, CARD_WIDTH } from "./looks/index.ts";
export type { Look, LookId, Scheme } from "./looks/index.ts";

export { parseOptions, parseLook, parseCards, parseFeeds, parsePrograms, parseHeadline, isLogin, OptionsError, DEFAULT_LOOK, DEFAULT_CARDS } from "./options.ts";
export type { Options } from "./options.ts";
export { renderCards, readmeSnippet, workflowYaml, newWorkflowUrl, cardLink, rawUrl, cardFileName, OUTPUT_BRANCH, ACTION_REF, WORKFLOW_PATH } from "./output.ts";
export type { CardFile } from "./output.ts";

export { demoProfile } from "./fixtures/demo.ts";
export { fontFaces } from "./fonts/index.ts";
export type { FontKey } from "./fonts/index.ts";
export { escapeXml } from "./util/text.ts";
