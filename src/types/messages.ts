import type { Channel } from './domain';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import type { FeedView } from '@/learning/feed-view';
import type { ActionRequest, AiResult, AiStatus, ChatRequest, ChatResult } from '@/learning/ai/service';
import type { NoteRequestInputs, NoteGenerationResult } from '@/learning/notes/generator';
import type { GeneratedNote, SavedNote } from '@/types/notes';
import type { AuthState, AuthUser } from '@/types/auth';
import type { UsageStatusView } from '@/types/usage';
import type { CodeSent, PaymentRecord, ProfilePatch, SignupTicket, SpaceAllowanceView, SpaceAuthorization } from '@/types/account';

/**
 * Typed runtime message protocol between extension contexts.
 * Add a message by extending MessageMap; request/response types flow from there.
 */
export interface MessageMap {
  /** ui → background: import the subscription list from the signed-in YouTube session. */
  'subscriptions/import': { req: Record<string, never>; res: ImportResult };
  /** ui → background: refresh the video library from channel uploads. */
  'library/sync': { req: { force?: boolean }; res: { ok: boolean; error?: string } };
  /** ui → background: compute (and store) the ready-to-render feed for a space now. */
  'library/view': { req: { modeId: string }; res: FeedView | null };
  /** ui → background: add a channel by URL, @handle, or channel id. */
  'channel/add': { req: { input: string }; res: { ok: true; channel: Channel } | { ok: false; error: string } };
  /** extension pages → background: search YouTube channels (anonymous). */
  'youtube/search-channels': { req: { query: string }; res: { ok: true; channels: YtChannel[] } | { ok: false; error: string } };
  /** extension pages → background: show a YouTube URL, reusing an open YouTube tab. */
  'youtube/open': { req: { url: string }; res: { ok: true } };
  /** any → background: which AI provider would answer, and whether it's ready. */
  'ai/status': { req: Record<string, never>; res: AiStatus };
  /** YouTube page → background: run a learner-requested AI action on the current moment. */
  'ai/run': { req: ActionRequest; res: AiResult };
  /** YouTube page → background: generate notes/mind-map for a scope, through WS2's generator (src/learning/notes/generator.ts) wired to the real provider. */
  'notes/generate': { req: { inputs: NoteRequestInputs }; res: NoteGenerationResult | { ok: false; code: 'unavailable' | 'failed' | 'quota_exceeded'; reason: string } };
  /** YouTube page → background: persist a generated note (wraps GeneratedNote into a SavedNote). */
  'notes/save': { req: { note: GeneratedNote }; res: SavedNote };
  /** YouTube page → background: saved notes for a video, most recent first. */
  'notes/list': { req: { videoId: string }; res: SavedNote[] };
  /** YouTube page → background: delete one saved note. */
  'notes/delete': { req: { videoId: string; id: string }; res: { ok: true } };
  /** YouTube page → background: one turn of the learning-companion chat (text or voice — same pipeline, see src/learning/ai/chat.ts). */
  'chat/send': { req: ChatRequest; res: ChatResult };
  /** any → background: open the dashboard at a route. */
  'dashboard/open': { req: { route?: string }; res: { ok: true } };
  /** any → background: current FocusSpace account state (null user = anonymous). Refreshes an about-to-expire access token first. */
  'auth/status': { req: Record<string, never>; res: AuthState };
  /** ui → background: create a FocusSpace account and sign in. */
  /** ui → background: sign in to an existing FocusSpace account. */
  'auth/login': { req: { email: string; password: string }; res: { ok: true; state: AuthState } | { ok: false; error: string } };
  /** ui → background: sign out (revokes the session server-side; always clears local state even if that call fails). */
  'auth/logout': { req: Record<string, never>; res: { ok: true } };
  /** Answer to "keep this browser's guest data with your account?" (background/ownership.ts). */
  'account/claim': { req: { keep: boolean }; res: { ok: boolean } };
  /** The signed-in learner's details and payments, for FocusSpace's own account page. */
  'account/profile': { req: Record<string, never>; res: AuthUser | null };
  'account/profile-update': { req: ProfilePatch; res: { ok: true; user: AuthUser } | { ok: false; error: string } };
  'account/payments': { req: Record<string, never>; res: PaymentRecord[] };
  /** ui → background: step 1 of creating an account — send a verification code to an email address. */
  'auth/signup-start': { req: { email: string }; res: CodeSent | { ok: false; error: string } };
  /** ui → background: step 2 — check the emailed code, returning a short-lived ticket. */
  'auth/signup-verify': { req: { email: string; code: string }; res: SignupTicket | { ok: false; error: string } };
  /** ui → background: step 3 — set the password, create the verified account, sign in. */
  'auth/signup-complete': { req: { ticket: string; password: string }; res: { ok: true; state: AuthState } | { ok: false; error: string } };
  /** ui → background: send a one-time code to a phone number. */
  'auth/phone-start': { req: { phone: string }; res: CodeSent | { ok: false; error: string } };
  /** ui → background: check the phone code and sign in (creating the account if the number is new). */
  'auth/phone-verify': { req: { phone: string; code: string }; res: { ok: true; state: AuthState; created: boolean } | { ok: false; error: string } };
  /** ui → background: how many Spaces this account's plan allows, and how many it uses. null = no account/server. */
  'spaces/allowance': { req: Record<string, never>; res: SpaceAllowanceView | null };
  /** ui → background: ask the server whether one more Space may be created (server is authoritative). */
  'spaces/authorize': { req: { spaceId: string; name?: string }; res: SpaceAuthorization };
  /** ui → background: a deleted Space frees its slot. */
  'spaces/release': { req: { spaceId: string }; res: { ok: true } };
  /** ui → background: the signed-in account's current plan/usage (Layer 2C) — null when signed out, no server configured, or unreachable. */
  'usage/status': { req: Record<string, never>; res: UsageStatusView | null };
  /** background → content: read subscriptions using the page's signed-in session. */
  'content/read-subscriptions': { req: Record<string, never>; res: SessionSubscriptionsResult };
  /** background → content: run a public YouTube data call from the youtube.com origin (YouTube rejects extension origins). */
  'content/youtube': { req: YouTubeRelayRequest; res: { ok: true; data: unknown } | { ok: false; error: string } };
  /** background → content: liveness check. */
  'content/ping': { req: Record<string, never>; res: { ok: true } };
  /** any → background: open a page of the public site (src/config.ts) in a new tab, reusing one if it is already open. */
  'site/open': { req: { path?: string }; res: { ok: true } };
}

export type MessageType = keyof MessageMap;
export type RequestOf<T extends MessageType> = MessageMap[T]['req'];
export type ResponseOf<T extends MessageType> = MessageMap[T]['res'];
export type RuntimeMessage = { [T in MessageType]: { type: T; payload: RequestOf<T> } }[MessageType];

export type YouTubeRelayRequest = { op: 'channelUploads'; channelId: string } | { op: 'searchChannels'; query: string };

export interface ImportedChannel {
  id: string;
  title: string;
  handle?: string;
  thumbnail?: string;
}

export type SessionSubscriptionsResult =
  | { ok: true; channels: ImportedChannel[]; complete: boolean }
  | { ok: false; code: 'signed-out' | 'parse-failed' | 'network'; error: string };

export type ImportResult =
  | { ok: true; imported: number; added: number; complete: boolean }
  | { ok: false; code: 'signed-out' | 'parse-failed' | 'network' | 'no-tab'; error: string };
