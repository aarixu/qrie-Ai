/** The tabs of one school's page, in order; the `tab` search parameter is one of these. */
export const SCHOOL_TABS = ['overview', 'people', 'activity', 'billing', 'switches', 'notes'] as const;
export type SchoolTab = (typeof SCHOOL_TABS)[number];

export const SCHOOL_TAB_TITLE: Record<SchoolTab, string> = {
  overview: 'Overview',
  people: 'People',
  activity: 'Activity',
  billing: 'Billing',
  switches: 'Switches',
  notes: 'Notes',
};
