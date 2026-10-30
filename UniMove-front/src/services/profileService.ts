import type { Me } from '../api/auth';

export type Profile = Me & {
  status: string;
  createdAt: string;
  course: string | null;
  semester: number | null;
  bio: string | null;
  tags: string[];
  profileCompletedAt: string | null;
};
export type ProfileInput = {
  course: string;
  semester: number;
  bio: string;
  tags: string[];
  fullName?: string;
};
export type ProfilePolicy = {
  course: { minLength: number; maxLength: number };
  semester: { min: number; max: number };
  bio: { minLength: number; maxLength: number };
  tags: { min: number; max: number; minLength: number; maxLength: number };
};
export type ProfileStats = {
  id: string;
  value: number;
  label: string;
  icon: 'map' | 'calendar' | 'star';
};
export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: 'profile' | 'car' | 'passenger' | 'users' | 'trophy' | 'star';
  unlocked: boolean;
  progress: {
    current: number;
    target: number;
    percentage: number | null;
    label: string;
  };
};
export type ProfileAchievements = {
  items: Achievement[];
  total: number;
  unlockedCount: number;
};
export type ProfileReview = {
  id: string;
  reviewerName: string;
  initials: string;
  score: number;
  comment: string;
  date: string;
};

type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export function getMyProfile(authApi: AuthApi) {
  return authApi<Profile>('/users/me');
}
export function getProfileAchievements(authApi: AuthApi) {
  return authApi<ProfileAchievements>('/users/me/achievements');
}
export function getProfilePolicy(authApi: AuthApi) {
  return authApi<ProfilePolicy>('/users/me/profile-policy');
}
export function updateProfile(authApi: AuthApi, input: ProfileInput) {
  return authApi<Profile>('/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
