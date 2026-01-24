// Parses the provided HTML of 100 bingo boards into a structured map.
// Each board is a 5x5 array of numbers; the center cell is treated as FREE.

type BoardGrid = number[]; // 25 entries, index 12 is FREE (represented as -1)

function parseBoardsFromHtml(html: string): Record<number, BoardGrid> {
  const container = document.createElement('div');
  container.innerHTML = html;
  const boardNodes = Array.from(container.querySelectorAll('.bingo-board'));
  const result: Record<number, BoardGrid> = {};
  
  for (const node of boardNodes) {
    const title = node.querySelector('.board-title')?.textContent?.trim() || '';
    const match = title.match(/Board\s+(\d+)/i);
    const id = match ? Number(match[1]) : NaN;
    
    const cells = Array.from(node.children)
      .filter((el) => !el.classList.contains('board-title') && !el.classList.contains('header'))
      .map((el) => {
        if ((el as HTMLElement).classList.contains('free')) return -1;
        return Number(el.textContent?.trim() || '0');
      });
    
    if (!Number.isNaN(id) && cells.length === 25) {
      result[id] = cells as BoardGrid;
    }
  }
  return result;
}

// Cache for parsed boards
let BOARDS_CACHE: Record<number, BoardGrid> | null = null;

export function loadBoards(html: string) {
  BOARDS_CACHE = parseBoardsFromHtml(html);
  console.log(`Loaded ${Object.keys(BOARDS_CACHE).length} boards`);
}

export function getBoard(id: number): BoardGrid | null {
  if (!BOARDS_CACHE) {
    console.error('Boards not loaded yet');
    return null;
  }
  return BOARDS_CACHE[id] || null;
}

export type { BoardGrid };