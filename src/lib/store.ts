"use client";

import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  setSidebar: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  setSidebar: (v) => set({ sidebarOpen: v }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
