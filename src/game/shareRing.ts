import type { Letter } from "../data/sets";
import type { LetterStatus } from "./engine";

export const PASALACABRA_LETTERS: string[] = [
    "A","B","C","D","E","F","G","H","I","J","L","M","N","Ñ","O","P","Q","R","S","T","U","V","X","Y","Z"
  ];
  
  // If you have an array of results aligned to the ring (length 25):
  // e.g. statuses[i] is "correct" | "wrong" | "skip"
  export function statusesFromArray(
    statuses: Array<"correct" | "wrong" | "skip">
  ): Record<string, "correct" | "wrong" | "skip"> {
    const map: Record<string, "correct" | "wrong" | "skip"> = {};
    for (let i = 0; i < PASALACABRA_LETTERS.length; i++) {
      map[PASALACABRA_LETTERS[i]] = statuses[i] ?? "skip";
    }
    return map;
  }

  function statusToEmoji(status: "correct" | "wrong" | "skip"): string {
    switch (status) {
      case "correct":
        return "🟢";
      case "wrong":
        return "🔴";
      case "skip":
        return "🔵";
    }
  }

  type BuildEmojiRingShareParams = {
    title: string;
    subtitle?: string;
    letters: readonly string[];
    statusesByLetter: Record<string, "correct" | "wrong" | "skip">;
    mode: "ring" | "linear" | "grid";
    playerCount?: number; // Optional: validate single-player game
  };

  export function buildEmojiRingShare({
    title,
    subtitle,
    letters,
    statusesByLetter,
    mode = "ring",
    playerCount,
  }: BuildEmojiRingShareParams): string {
    // Share feature is only available for single-player games
    if (playerCount !== undefined && playerCount !== 1) {
      throw new Error("Share feature is only available for single-player games. Please provide playerCount: 1 or omit it.");
    }
    const lines: string[] = [title];
    
    if (subtitle) {
      lines.push(subtitle);
    }
    
    lines.push(""); // Empty line separator
    
    if (mode === "ring") {
      // Arrange emojis in a circular ring pattern within an 11x10 grid
      // Pattern matches the visual structure with letters arranged around the perimeter
      const gridWidth = 11;
      const gridHeight = 10;
      
      // Create an 11x10 grid filled with black squares
      const grid: string[][] = Array(gridHeight)
        .fill(null)
        .map(() => Array(gridWidth).fill("⬛"));
      
      // Predefined positions for the ring pattern (11x10 grid)
      // Positions arranged clockwise starting from [0,5] (A) and ending at [0,4] (Z)
      // Format: [row, col] for each of the 25 letters
      // Pattern: ⬛⬛⬛⬛🔵🟢🟢⬛⬛⬛⬛ (row 0) - Z at [0,4], A at [0,5]
      //          ⬛⬛🔵🔵⬛⬛⬛🟢🟢⬛⬛ (row 1)
      //          ⬛🔵⬛⬛⬛⬛⬛⬛⬛🟢⬛ (row 2)
      //          🔵⬛⬛⬛⬛⬛⬛⬛⬛⬛🟢 (rows 3-6)
      //          ⬛🔵⬛⬛⬛⬛⬛⬛⬛🔴⬛ (row 7)
      //          ⬛⬛🔵⬛⬛⬛⬛⬛🟢⬛⬛ (row 8)
      //          ⬛⬛⬛🔵🔵⬛🔵🟢⬛⬛⬛ (row 9)
      const ringPositions: Array<[number, number]> = [
        // Starting at [0,5] for A, going clockwise, ending at [0,4] for Z
        [0, 5],                   // A (position 0)
        [0, 6],                   // B
        [1, 7], [1, 8],           // C, D
        [2, 9],                   // E
        [3, 10], [4, 10], [5, 10], [6, 10], // F, G, H, I
        [7, 9],                   // J
        [8, 8],                   // L
        [9, 7], [9, 6], [9, 4], [9, 3], // M, N, Ñ, O
        [8, 2],                   // P
        [7, 1],                   // Q
        [6, 0], [5, 0], [4, 0], [3, 0], // R, S, T, U
        [2, 1],                   // V
        [1, 3], [1, 2],           // X, Y
        [0, 4],                   // Z (position 24)
      ];
      
      // Place each letter at its predefined position
      for (let i = 0; i < letters.length && i < ringPositions.length; i++) {
        const [row, col] = ringPositions[i];
        const letter = letters[i];
        const status = statusesByLetter[letter] ?? "skip";
        grid[row][col] = statusToEmoji(status);
      }
      
      // Convert grid to lines
      for (let y = 0; y < gridHeight; y++) {
        lines.push(grid[y].join(""));
      }
      
    } else if (mode === "grid") {
      // Arrange in a grid format (default 5 columns)
      const columns = 5;
      const emojis = letters.map(letter => {
        const status = statusesByLetter[letter] ?? "skip";
        return statusToEmoji(status);
      });
      
      for (let i = 0; i < emojis.length; i += columns) {
        lines.push(emojis.slice(i, i + columns).join(""));
      }
      
    } else {
      // Linear mode: single line
      const emojis = letters.map(letter => {
        const status = statusesByLetter[letter] ?? "skip";
        return statusToEmoji(status);
      });
      lines.push(emojis.join(""));
    }
    
    return lines.join("\n");
  }

  /**
   * Shares the game results as an emoji sequence.
   * Only works for single-player games.
   * 
   * @param statusByLetter - Record mapping each letter to its status ("correct", "wrong", "pending", "current", "passed")
   * @param playerName - Optional player name for generating game ID
   * @returns Promise that resolves when sharing is complete, or rejects with an error
   */
  export async function shareEmojiSequence(
    statusByLetter: Record<Letter, LetterStatus>,
    playerName?: string
  ): Promise<void> {
    // Convert LetterStatus to share format
    const statusesByLetter: Record<string, "correct" | "wrong" | "skip"> = {};
    let correct = 0;
    let wrong = 0;
    let skip = 0;

    for (const letter of PASALACABRA_LETTERS) {
      const status = statusByLetter[letter as Letter];
      if (status === "correct") {
        statusesByLetter[letter] = "correct";
        correct++;
      } else if (status === "wrong") {
        statusesByLetter[letter] = "wrong";
        wrong++;
      } else {
        // "pending", "current", "passed" -> "skip"
        statusesByLetter[letter] = "skip";
        skip++;
      }
    }

    // Generate a simple game ID (using player name or timestamp)
    const gameId = playerName
      ? playerName.toLowerCase().replace(/\s+/g, "-")
      : `game-${Date.now().toString().slice(-6)}`;

    // Build the share text
    const shareText = buildEmojiRingShare({
      title: `Pasalacabra #${gameId}`,
      subtitle: `${correct}✅ ${wrong}❌ · ${skip}⏭`,
      letters: PASALACABRA_LETTERS,
      statusesByLetter,
      mode: "ring",
      playerCount: 1, // Validate single-player
    });

    // Share using Web Share API if available, otherwise copy to clipboard
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Pasalacabra",
          text: shareText,
        });
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(shareText);
        alert("¡Resultados copiados al portapapeles!");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        // User cancelled or error occurred
        // Fallback: try copying to clipboard
        try {
          await navigator.clipboard.writeText(shareText);
          alert("¡Resultados copiados al portapapeles!");
        } catch (clipboardErr) {
          console.error("Failed to copy to clipboard:", clipboardErr);
          alert("Error al compartir. Por favor, copia manualmente el texto.");
        }
      }
    }
  }