import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly } from './common.js';

export const VOTE_TARGETS = ['THREAD', 'POST'] as const;
export type VoteTargetType = (typeof VOTE_TARGETS)[number];

export const forumVoteSchema = z.object({
  target_type: z.enum(VOTE_TARGETS),
  target_id: z.uuid(),
});
export type ForumVoteDTO = z.infer<typeof forumVoteSchema>;

export interface ForumVoteDoc {
  user_id: string;
  target_type: VoteTargetType;
  target_id: string;
  created_at: Date;
}

const s = new Schema<ForumVoteDoc>(
  {
    user_id: { type: String, required: true },
    target_type: { type: String, enum: VOTE_TARGETS, required: true },
    target_id: { type: String, required: true },
  },
  { timestamps: createdOnly, versionKey: false },
);
// PK compuesta del DER (user_id, target_type, target_id)
s.index({ user_id: 1, target_type: 1, target_id: 1 }, { unique: true });

export const ForumVote: Model<ForumVoteDoc> = model<ForumVoteDoc>('ForumVote', s);
export default ForumVote;
