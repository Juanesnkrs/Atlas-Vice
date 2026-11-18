import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';

export const NEWS_SOURCES = ['rockstar-newswire', 'rockstar-youtube', 'take-two-ir'] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];

/** Contrato consumido por workers/officialNewsWorker.ts y routes/seo.ts. */
export const officialNewsSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  sourceUrl: z.string().url(),
  source: z.enum(NEWS_SOURCES),
  imageUrl: z.string().url().optional(),
  publishedAt: z.coerce.date(),
  slug: z.string().min(1),
});
export type OfficialNewsInput = z.infer<typeof officialNewsSchema>;

export interface OfficialNewsDoc extends OfficialNewsInput {
  createdAt: Date;
  updatedAt: Date;
}

const s = new Schema<OfficialNewsDoc>(
  {
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    sourceUrl: { type: String, required: true, unique: true },
    source: { type: String, enum: NEWS_SOURCES, required: true },
    imageUrl: { type: String },
    publishedAt: { type: Date, required: true, index: -1 },
    slug: { type: String, required: true },
  },
  { timestamps: true },
);
s.index({ slug: 1 }, { unique: true });

export const OfficialNews: Model<OfficialNewsDoc> = model<OfficialNewsDoc>('OfficialNews', s);
export default OfficialNews;
