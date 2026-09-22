import type { ChatProvider } from "@/lib/llm/provider";
import type { QuestionType } from "@/lib/config";
import type { GeneratedQuestion, Outline, Topic } from "@/lib/types";

export type OutlineRequest = {
  materialText: string;
  topicCount: number;
  signal?: AbortSignal;
};

export type QuestionRequest = {
  materialText: string;
  topics: Topic[];
  /** 题型配比，允许只给出关心的题型（未给出的题型不生成）。 */
  mix: Partial<Record<QuestionType, number>>;
  count: number;
  signal?: AbortSignal;
};

export type QuestionResponse = {
  questions: GeneratedQuestion[];
  model: string;
  raw: unknown;
};

export interface GenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly origin: "byok" | "platform" | "offline";
  generateOutline(request: OutlineRequest): Promise<Outline>;
  generateQuestions(request: QuestionRequest): Promise<QuestionResponse>;
}

export type { ChatProvider };
