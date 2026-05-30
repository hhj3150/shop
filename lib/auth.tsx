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
  profileLoaded: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

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
    } finally {
      setProfileLoaded(true);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      setProfileLoaded(true);
      return;
    }
    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      else setProfileLoaded(true);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        setProfileLoaded(false);
        loadProfile(next.user.id);
      } else {
        setProfile(null);
        setProfileLoaded(true);
      }
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
      profileLoaded,
      signOut: async () => {
        await getSupabase().auth.signOut();
        setSession(null);
        setProfile(null);
      },
      refreshProfile: async () => {
        if (session?.user) await loadProfile(session.user.id);
      },
    }),
    [ready, session, profile, profileLoaded]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
