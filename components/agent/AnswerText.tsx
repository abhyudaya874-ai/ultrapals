"use client";
import type { Source } from "@/lib/research/sources";
import { Markdown } from "./Markdown";

/** The serif answer in the thread: markdown (tables, nested lists, headings, code) with inline citation chips. */
export function AnswerText({ text, sources, onOpen }: { text: string; sources: Source[]; onOpen: (n: number) => void }) {
  return <Markdown text={text} sources={sources} onOpen={onOpen} serif />;
}
