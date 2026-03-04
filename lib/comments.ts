export type RawComment = Record<string, unknown>;

export type CommentItem = {
  id: string;
  author: string;
  text: string;
  likes: number;
  timestamp: number | null;
  postedAt: string | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }

  // yt-dlp usually returns unix seconds. Convert milliseconds if needed.
  return parsed > 9999999999 ? Math.floor(parsed / 1000) : Math.floor(parsed);
}

function pickCommentText(comment: RawComment): string {
  const candidates = [
    comment.text,
    comment.comment_text,
    comment.content,
    comment.comment,
    comment.html
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

export function normalizeComments(rawComments: unknown): CommentItem[] {
  if (!Array.isArray(rawComments)) {
    return [];
  }

  return rawComments
    .map((entry, index): CommentItem | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const comment = entry as RawComment;
      const text = pickCommentText(comment);
      if (!text) {
        return null;
      }

      const likesRaw =
        toNumber(comment.like_count) ??
        toNumber(comment.likes) ??
        toNumber(comment.vote_count) ??
        toNumber(comment.votes) ??
        0;
      const likes = Math.max(0, Math.floor(likesRaw));
      const timestamp = normalizeTimestamp(comment.timestamp);
      const postedAt = timestamp ? new Date(timestamp * 1000).toISOString() : null;
      const author =
        (typeof comment.author === "string" && comment.author.trim()) ||
        (typeof comment.author_id === "string" && comment.author_id.trim()) ||
        (typeof comment.username === "string" && comment.username.trim()) ||
        "Unknown";
      const id =
        (typeof comment.id === "string" && comment.id.trim()) ||
        (typeof comment.comment_id === "string" && comment.comment_id.trim()) ||
        `comment_${index + 1}`;

      return {
        id,
        author,
        text,
        likes,
        timestamp,
        postedAt
      };
    })
    .filter((item): item is CommentItem => item !== null);
}

export function sortCommentsByPopularity(comments: CommentItem[]): CommentItem[] {
  return [...comments].sort((a, b) => {
    if (b.likes !== a.likes) {
      return b.likes - a.likes;
    }

    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });
}

export function prepareCommentsForPrompt(
  comments: CommentItem[],
  opts?: { maxComments?: number; maxChars?: number }
): { included: CommentItem[]; omittedCount: number } {
  const maxComments = opts?.maxComments ?? 250;
  const maxChars = opts?.maxChars ?? 35000;

  const included: CommentItem[] = [];
  let chars = 0;

  for (const comment of comments.slice(0, maxComments)) {
    const compact = {
      author: comment.author,
      likes: comment.likes,
      text: comment.text
    };
    const encoded = JSON.stringify(compact);
    if (chars + encoded.length > maxChars) {
      break;
    }
    chars += encoded.length;
    included.push(comment);
  }

  return {
    included,
    omittedCount: Math.max(0, comments.length - included.length)
  };
}
