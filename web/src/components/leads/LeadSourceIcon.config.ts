// web/src/components/leads/LeadSourceIcon.config.ts
//
// Pure visual config for LeadSourceIcon. The Icon component reference is a
// React component (Lucide icon). Tested for completeness (all sources have
// entries) and shape, not rendering.

import {
  Globe,
  Monitor,
  Instagram,
  Facebook,
  Building2,
  Footprints,
  Users,
  Briefcase,
  Building,
  Heart,
  UsersRound,
  MoreHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LeadSource } from '../../types/lead';

export interface LeadSourceVisualConfig {
  label: string;
  Icon: LucideIcon;
  /** Tooltip / aria-label fallback. */
  description: string;
}

export const LEAD_SOURCE_CONFIG: Record<LeadSource, LeadSourceVisualConfig> = {
  GOOGLE: { label: 'Google', Icon: Globe, description: 'Lead from Google search or Maps' },
  WEBSITE: { label: 'Website', Icon: Monitor, description: 'Lead from hotel website form' },
  INSTAGRAM: { label: 'Instagram', Icon: Instagram, description: 'Lead from Instagram DM or profile' },
  FACEBOOK: { label: 'Facebook', Icon: Facebook, description: 'Lead from Facebook message or page' },
  OTA: { label: 'OTA', Icon: Building2, description: 'Lead from an OTA (MMT, Goibibo, Booking, etc.)' },
  WALK_IN: { label: 'Walk-in', Icon: Footprints, description: 'Guest walked in without prior booking' },
  REFERRAL: { label: 'Referral', Icon: Users, description: 'Referred by an existing guest' },
  AGENT: { label: 'Agent', Icon: Briefcase, description: 'Travel agent booking' },
  CORPORATE: { label: 'Corporate', Icon: Building, description: 'Corporate / company booking' },
  WEDDING: { label: 'Wedding', Icon: Heart, description: 'Wedding planner / event booking' },
  GROUP: { label: 'Group', Icon: UsersRound, description: 'Group / school / tour booking' },
  OTHER: { label: 'Other', Icon: MoreHorizontal, description: 'Other source (free-form)' },
};
