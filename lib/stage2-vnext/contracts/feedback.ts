export interface FeedbackEvent {
  channelId: string;
  candidateId: string;
  type:
    | "explicit_like"
    | "explicit_dislike"
    | "selected"
    | "edited"
    | "published"
    | "post_publication_metric";
  value?: number | string | null;
  createdAt: string;
}
