import type { ThemeId } from "./types";

export type Theme = {
  name: string;
  floor: string;
  floorAlt: string;
  line: string;
  wall: string;
  crate: string;
  tree: string;
  backdrop: string;
  /** Colour of the darkness in fogged areas. */
  fog: string;
  blood: string;
};

export const THEMES: Record<ThemeId, Theme> = {
  concrete: {
    name: "Concrete",
    floor: "#d6d6d6",
    floorAlt: "#d0d0d0",
    line: "#c4c4c4",
    wall: "#9c9c9c",
    crate: "#a07a48",
    tree: "#4f7a3a",
    backdrop: "#8f8f8f",
    fog: "8,10,14",
    blood: "#9a1818",
  },
  warehouse: {
    name: "Warehouse",
    floor: "#c9bfae",
    floorAlt: "#c2b8a6",
    line: "#b6ab98",
    wall: "#8d7f6a",
    crate: "#a8743c",
    tree: "#4f7a3a",
    backdrop: "#6e6558",
    fog: "12,10,8",
    blood: "#8a1414",
  },
  hospital: {
    name: "Hospital",
    floor: "#d3e2df",
    floorAlt: "#cadbd8",
    line: "#b9cdc9",
    wall: "#8fa8a6",
    crate: "#b9c4c8",
    tree: "#4f7a3a",
    backdrop: "#5f7372",
    fog: "6,12,14",
    blood: "#a01a1a",
  },
  forest: {
    name: "Forest",
    floor: "#7d9a5c",
    floorAlt: "#77945a",
    line: "#71905a",
    wall: "#6d6458",
    crate: "#8a6234",
    tree: "#2f5a2a",
    backdrop: "#3e4f30",
    fog: "6,10,6",
    blood: "#7a1010",
  },
  sewer: {
    name: "Sewer",
    floor: "#7c8070",
    floorAlt: "#747866",
    line: "#6c7062",
    wall: "#545a4c",
    crate: "#6e5636",
    tree: "#3f5a2a",
    backdrop: "#2c3028",
    fog: "4,6,4",
    blood: "#6e1010",
  },
  lab: {
    name: "Research Lab",
    floor: "#e4e8ee",
    floorAlt: "#dce2ea",
    line: "#c9d2de",
    wall: "#7f8ea4",
    crate: "#9aa6b6",
    tree: "#4f7a3a",
    backdrop: "#3c4658",
    fog: "4,8,16",
    blood: "#a01a2a",
  },
  suburb: {
    name: "Suburb",
    floor: "#a9a294",
    floorAlt: "#a39c8e",
    line: "#99927f",
    wall: "#b08a6a",
    crate: "#946a3e",
    tree: "#3f6a32",
    backdrop: "#5b6a48",
    fog: "8,10,8",
    blood: "#8a1414",
  },
  military: {
    name: "Military",
    floor: "#a8a68a",
    floorAlt: "#a1a084",
    line: "#97957a",
    wall: "#6e7254",
    crate: "#6f6a3e",
    tree: "#46602e",
    backdrop: "#4a4c38",
    fog: "8,10,6",
    blood: "#841414",
  },
};
