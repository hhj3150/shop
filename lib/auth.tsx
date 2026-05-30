"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export type Profile = {
  id: string;
  name: string;
  phone: string;
  postcode: string | null;
  address: string | null;
  address_detail: string | null;
  is_admin: boolean;
};

type AuthContextValue = {
  ready: boolean;
  configured: boolean;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  async function loadProfile(userId: string) {
    try {
      const { data } = await getSupabase()
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      setProfile((data as Profile) ?? null);
    } catch (error) {
      console.error("프로필 조회 실패:", error);
      setProfile(null);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) loadProfile(next.user.id);
      else setProfile(null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      configured: isSupabaseConfigured,
      user: session?.user ?? null,
      session,
      profile,
      signOut: async () => {
        await getSupabase().auth.signOut();
        setSession(null);
        setProfile(null);
      },
      refreshProfile: async () => {
        if (session?.user) await loadProfile(session.user.id);
      },
    }),
    [ready, session, profile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
