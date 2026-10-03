import type { SheetReport } from '@ai-tutor/board-layout';

/**
 * What assemble reports about one page of a composed class (board composer):
 * board-layout's report, and where in the lesson the class leaves the page.
 */
export interface PageReport extends SheetReport {
  /** The lesson beat on which the class leaves this page. */
  beat: string;
  /** The planner beat, one subtopic, the page belongs to. */
  plannerBeat: string;
  /** The opening beat teaches nothing by the prompt's contract, and is not held to a full page. */
  opening: boolean;
}

export interface ComposerReport {
  pages: PageReport[];
  /** The lesson beats on which the camera pulls back to the whole page. */
  overview: string[];
}
