"use client";
import { createContext, useContext } from "react";
import type { Level } from "@/lib/computer/models";
import { effortOf, type EffortTheme } from "./effort";

const Ctx = createContext<Level>("standard");

/** Tells every orb below it which effort level the person chose for this conversation. */
export const EffortProvider = Ctx.Provider;

/** The theme in force: the `level` an orb was handed (a form that has its own slider), else the conversation's. */
export function useEffort(level?: Level): EffortTheme {
  const fromConversation = useContext(Ctx);
  return effortOf(level ?? fromConversation);
}
