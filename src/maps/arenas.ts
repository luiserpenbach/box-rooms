import type { MapDef } from "./types";

export const ARENA_DEFS: MapDef[] = [
  {
    id: "open",
    name: "The Yard",
    mode: "survival",
    theme: "concrete",
    blurb: "Four walls, eight doors, nowhere to hide.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#                                      #
#                                      #
#                                      #
#                                      #
#                  12                  #
#                                      #
#                                      #
#                                      #
#                                      #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "pillars",
    name: "Pillars",
    mode: "survival",
    theme: "warehouse",
    blurb: "Scattered pillars to dance around.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#      ####              ####          #
#                                      #
#              ####                    #
#                                      #
#                  12                  #
#                                      #
#                    ####              #
#                                      #
#          ####              ####      #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "cross",
    name: "The Cross",
    mode: "survival",
    theme: "lab",
    blurb: "A concrete cross splits the room.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#                                      #
#                ####                  #
#                ####                  #
#                ####                  #
#          ##############              #
#                  12                  #
#                ####                  #
#                ####                  #
#                ####                  #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "split",
    name: "Split Hall",
    mode: "survival",
    theme: "concrete",
    blurb: "A divider wall with a gap in the middle.",
    darkness: 0,
    raw: `
########DD####################DD########
D                 ##                   D
#                 ##                   #
#                 ##                   #
#                 ##                   #
#                                      #
#         1                  2         #
#                                      #
#                 ##                   #
#                 ##                   #
#                 ##                   #
D                 ##                   D
########DD####################DD########
`,
  },
  {
    id: "corners",
    name: "Corner Bunkers",
    mode: "survival",
    theme: "military",
    blurb: "Bunker corners — great until they flank you.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#  ######                      ######  #
#  ##                              ##  #
#  ##                              ##  #
#                                      #
#                  12                  #
#                                      #
#  ##                              ##  #
#  ##                              ##  #
#  ######                      ######  #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "ring",
    name: "The Ring",
    mode: "survival",
    theme: "hospital",
    blurb: "A broken ring in the centre of the hall.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#                                      #
#          ######      ######          #
#          ##              ##          #
#          ##              ##          #
#                  12                  #
#          ##              ##          #
#          ##              ##          #
#          ######      ######          #
#                                      #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "stagger",
    name: "Stagger",
    mode: "survival",
    theme: "warehouse",
    blurb: "Staggered walls funnel the horde.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#          ##########                  #
#                                      #
#                  ##########          #
#                                      #
#         1                  2         #
#                                      #
#          ##########                  #
#                                      #
#                  ##########          #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "hall",
    name: "Long Hall",
    mode: "survival",
    theme: "suburb",
    blurb: "A long hall with rows of cover.",
    darkness: 0,
    raw: `
########DD####################DD################
D                                              D
#                                              #
#      ####          ####          ####        #
#                                              #
#                    12                        #
#                                              #
#        ####          ####          ####      #
#                                              #
D                                              D
########DD####################DD################
`,
  },
  {
    id: "chambers",
    name: "Chambers",
    mode: "survival",
    theme: "sewer",
    blurb: "Two chambers joined by a narrow pass.",
    darkness: 0,
    raw: `
########DD####################DD########
D               ##                     D
#               ##                     #
#               ##                     #
#       1                              #
#               ##                     #
##################                     #
#               ##                     #
#                      2               #
#               ##                     #
#               ##                     #
D               ##                     D
########DD####################DD########
`,
  },
  {
    id: "fort",
    name: "Fort",
    mode: "survival",
    theme: "military",
    blurb: "Hold the fort between four blocks.",
    darkness: 0,
    raw: `
########DD####################DD########
D                                      D
#                                      #
#     ####                    ####     #
#     ####                    ####     #
#                                      #
#              ##  12  ##              #
#                                      #
#     ####                    ####     #
#     ####                    ####     #
#                                      #
D                                      D
########DD####################DD########
`,
  },
  {
    id: "depot",
    name: "Freight Depot",
    mode: "survival",
    theme: "warehouse",
    blurb: "Shelving rows, explosive barrels and six loading doors.",
    darkness: 0,
    raw: `
########DD################DD################DD########
#                                                    #
#                                                    #
#                                                    #
#                                                    #
#                                                    #
#     cccccccccccc  cccccccccccc  cccccccccccc       #
#                                                    #
D                                                    D
#            b                          b            #
#                                                    #
#     cccccccccccc  cccccccccccc  cccccccccccc       #
#                                                    #
#                       ######                       #
#    +                 b######                  +    #
#                       ######b                      #
#                       ######                       #
#                         12                         #
#     cccccccccccc  cccccccccccc  cccccccccccc       #
#                                                    #
#            b                          b            #
D                                                    D
#                                                    #
#     cccccccccccc  cccccccccccc  cccccccccccc       #
#                                                    #
#                                                    #
#                                                    #
#                                                    #
#                                                    #
########DD################DD################DD########
`,
  },
  {
    id: "blackout",
    name: "Blackout",
    mode: "survival",
    theme: "lab",
    blurb: "The power's out. Fight by lamplight and muzzle flash.",
    darkness: 0.75,
    raw: `
######DD################################DD######
#                                              #
#                                              #
#                       +                      #
#    L                                    L    #
#                                              #
#         ########            ########         #
#         ########      L     ########         #
#         ########            ########         #
#                                              #
#                                              #
#                                              #
#                     cccc                     #
D                   b cccc                     D
D               12    cccc b                   D
#                     cccc                     #
#                                              #
#                                              #
#                                              #
#         ########            ########         #
#         ########      L     ########         #
#         ########            ########         #
#                                              #
#    L                                    L    #
#                       +                      #
#                                              #
#                                              #
######DD################################DD######
`,
  },
  {
    id: "courtyard",
    name: "Overgrown Court",
    mode: "survival",
    theme: "forest",
    blurb: "An overgrown courtyard. The trees hide more than you.",
    darkness: 0,
    raw: `
ttttttttttttDDttttttttttttttttttttttttDDtttttttttttt
t                                                  t
t                                                  t
t                                                  t
t               tt          t          tt          t
t     t           t   ########                  t  t
t                                    t             t
t                      t              t            t
t                         +                   t    t
t                                         t        t
D         t                                        D
D                                                  D
t                         t                        t
t                                                  t
t       #      t                           #       t
t       #                b                 #       t
t       #            t   12          tt    #       t
t       #                  b            t  #       t
t                                                  t
t     t                                            t
D        t  t         t                            D
D     t  tt               t            t           D
t                                                  t
t                         + t          t   t       t
t                                 t                t
t                                                  t
t                     ########                     t
t                                                  t
t                                                  t
t                                                  t
t                                                  t
ttttttttttttDDttttttttttttttttttttttttDDtttttttttttt
`,
  },
  {
    id: "bunker",
    name: "The Bunker",
    mode: "survival",
    theme: "military",
    blurb: "Hold the barricaded bunker as long as the boards last.",
    darkness: 0,
    raw: `
##########DD############DD############DD##########
#                                                #
#                                                #
#                                                #
#                                                #
#     c                                    c     #
#                                                #
D                                                D
D                                                D
#              #####==##  ##==#####              #
#              #                  #              #
#              # +              b #              #
#              #                  #              #
#              =      cccccc      =              #
#              =                  =              #
#              =        12        =              #
#              =                  =              #
#              #                  #              #
#              # b              + #              #
#              #                  #              #
#              #####==##  ##==#####              #
D                                                D
D                                                D
#                                                #
#     c                                    c     #
#                                                #
#                                                #
#                                                #
#                                                #
##########DD############DD############DD##########
`,
  },
];
