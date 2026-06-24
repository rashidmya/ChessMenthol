from __future__ import annotations

import argparse
from typing import List, Optional

import chess

from .analysis.classify import Classification, classify_move
from .engine.manager import EngineManager
from .engine.types import AnalysisInfo


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="chessmenthol-analyze",
        description="Analyze a chess position with the bundled engines.",
    )
    p.add_argument("--fen", required=True, help="Position to analyze (FEN).")
    p.add_argument("--depth", type=int, default=18, help="Search depth.")
    p.add_argument("--lines", type=int, default=3,
                   help="Number of PV lines (>=2 enables the 'great' classification).")
    p.add_argument("--engine", default="stockfish",
                   choices=["stockfish", "stockfish_lite"])
    p.add_argument("--prev-fen", default=None,
                   help="Position the --move was played from (enables classification).")
    p.add_argument("--move", default=None, help="UCI move played from --prev-fen.")
    return p


def format_lines(board: chess.Board, analysis: AnalysisInfo) -> str:
    rows = []
    for line in analysis.lines:
        san = board.variation_san(line.pv) if line.pv else ""
        rows.append(f"  [{line.multipv}] {line.eval.format_white():>7}  {san}")
    return "\n".join(rows)


def format_report(board: chess.Board, analysis: AnalysisInfo,
                  classification: Optional[Classification]) -> str:
    parts = [
        f"FEN: {board.fen()}",
        f"Depth: {analysis.depth}",
        "Lines:",
        format_lines(board, analysis),
    ]
    if classification is not None:
        parts.append(
            f"Move class: {classification.label.value} "
            f"(cpl={classification.cpl}, best={classification.is_best})"
        )
    return "\n".join(parts)


def run(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    board = chess.Board(args.fen)

    prev = None
    move = None
    if args.prev_fen and args.move:
        prev = chess.Board(args.prev_fen)
        move = chess.Move.from_uci(args.move)
        after = prev.copy()
        after.push(move)
        if after.epd() != board.epd():
            parser.error(
                "--fen must be the position after playing --move from --prev-fen"
            )

    classification = None
    with EngineManager() as em:
        em.select(args.engine)
        analysis = em.analyze(board, depth=args.depth, multipv=args.lines)
        if prev is not None and move is not None:
            before_a = em.analyze(prev, depth=args.depth, multipv=args.lines)
            classification = classify_move(prev, move, before_a, analysis)
    print(format_report(board, analysis, classification))
    return 0


def main() -> None:
    raise SystemExit(run())
