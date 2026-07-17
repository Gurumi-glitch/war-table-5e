/**
 * CSV helpers for the seed codegen. Used by `gen-enemies.mjs`.
 *
 * This file used to also carry the PHB spell/weapon mappers and their curated
 * rule tables. That data source is gone (see scripts/gen-library.mjs — the CSVs
 * were extracted from an uploaded Player's Handbook and could never ship), and
 * the curation moved into gen-library.mjs alongside the SRD mapping it serves.
 */
import { readFileSync } from "node:fs";

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells;
}

export function str(s) {
  return (s ?? "").toString();
}

export function readCsv(path) {
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
  const physical = raw.split(/\r?\n/);
  const records = [];
  let buf = "";
  let inQ = false;
  for (const line of physical) {
    if (buf.length > 0) buf += "\n";
    buf += line;
    // Update quote state by scanning this physical line for unescaped quotes.
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') i++; // doubled quote inside a cell
        else inQ = !inQ;
      }
    }
    if (!inQ) {
      records.push(buf);
      buf = "";
    }
  }
  if (buf.length > 0) records.push(buf);

  const header = parseCsvLine(records[0]);
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.length === 0) continue;
    const cells = parseCsvLine(rec);
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = (cells[j] ?? "").trim();
    rows.push(obj);
  }
  return rows;
}
