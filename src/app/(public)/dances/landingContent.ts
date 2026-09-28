// Feature 050 (P7-R6): committed, typed landing-page content per dance style (hand-built — clarified; no CMS).
// The club's own voice, migrated from the existing site (lifted, not rewritten). Copy is edited HERE without
// touching component logic. The role/gendered-language note is STYLE-SPECIFIC (spec FR-001): contra & community
// use gender-free Larks/Robins; English uses traditional men's/women's line terms (some callers moving toward
// positional). Series keys come from SERIES_KEYS (088, B48).

import { SERIES_KEYS, type SeriesKey } from "@/server/domain/series/seriesKeys";

export type StyleLanding = {
  slug: string; // route param + marketing slug
  seriesKey: SeriesKey; // club series key (drives color/hero/dance filter)
  title: string; // the page <h1>
  intro: string[]; // "what it is"
  whyYoullLove: string[]; // "why you'll love it" (the club's voice / testimonials)
  whatToExpect: string[]; // "what to expect" (incl. no partner needed, dress, etiquette, style role terms)
};

const CONTRA: StyleLanding = {
  slug: "contra",
  seriesKey: SERIES_KEYS.tnc,
  title: "What is contra dancing?",
  intro: [
    "Contra dance is a social folk dance with roots going back over 400 years. Couples line up in two facing lines and dance a sequence of figures — some with the person beside you, some with the couple across from you, and some with everyone at once. After each sequence, you move down the line and dance with the next couple. By the end of the night, you've danced with everyone in the room.",
    "Every dance is taught before it starts. The caller walks everyone through the figures, so no prior experience is needed. Experienced dancers gladly help beginners along during the dance itself.",
    "Contra is not country line dancing.",
  ],
  whyYoullLove: [
    "Social — you interact directly and equally with everyone in the room.",
    "Accessible — the basic footwork is simple. If you can walk, you can dance.",
    "Not boring — there are thousands of arrangements of the figures, plus room for personal flourishes.",
    "Live music, every week.",
    "Welcoming — new dancers are genuinely welcomed and helped.",
  ],
  whatToExpect: [
    "No partner needed. You'll change partners for each dance — it's actually good for beginners to dance a few with experienced partners, who can point you in the right direction. Anyone can ask anyone to dance regardless of gender, and same-sex pairings are common and welcome.",
    "What to wear: light, comfortable clothes — contra is mildly aerobic. T-shirts and shorts are common; swirly skirts are popular. Wear non-marking, low or flat shoes with clean soles, and please skip fragrance — some dancers have allergies. Bring a water bottle, and maybe a spare shirt for the drive home.",
    "Gender-free calling. As an organization, we have chosen to use gender inclusive terms in our dance. We often dance to Larks/Robins or positional calling. Our commitment to gender-free terminology reflects our belief that non-binary, gender-fluid, and LGBTQIA+ dancers are valued and welcome members of our community. Many of us have enjoyed dancing both Lark and Robin roles, and we've received a lot of positive feedback that this approach helps make Rochester's dance a safe and affirming space.",
    "Eye contact. Contra dancers often make eye contact during figures, especially the swing — it adds to the connection and helps prevent dizziness. If it feels uncomfortable, look at your partner's shoulder or forehead instead. No one is required to.",
    "Just show up. Every dance is taught by the caller before it's danced — no classes required.",
  ],
};

const ENGLISH: StyleLanding = {
  slug: "english",
  seriesKey: SERIES_KEYS.ecd,
  title: "What is English country dance?",
  intro: [
    "English Country Dance (ECD) is a social folk dance with roots in 17th- and 18th-century England. If you've seen a Jane Austen film like Pride and Prejudice, you've seen it. The tradition was revived in the 20th century and is still growing — new dances are being choreographed and new music composed in this style today.",
    "Most dances are done in two long facing lines. Two couples dance together through a sequence of figures, then move up or down the line to dance with the next couple. By the end of the dance, you've interacted with everyone in the set. Other formations include circles and small groups.",
    "The steps are simple — mostly walking, occasionally skipping. No fancy footwork, no ballroom hold. If you can walk, skip, and slip sideways, you can do these dances. Every dance is taught by a caller before it starts, then prompted throughout.",
  ],
  whyYoullLove: [
    "The music is one of ECD's most distinctive features — tunes drawn from old ballads, classical composers like Handel, Irish and Celtic airs, opera, and original compositions. Lively jigs, elegant marches, romantic waltzes, and driving reels: the mood shifts from dance to dance.",
    "“What I love about it is the variety. Different keys, time signatures, and character — I love playing something new with every song. Being able to dance to live music really is the best.” — Laurel, musician",
    "“I've always been a fan of history and the Regency period in particular. It's a blast to transport oneself so easily into another time. The music is intoxicating and the figures have such potential for drama.” — Aniela",
    "“It's ageless — dancers from 9 to 90 get in the set every week. Our kids love to spin about in the turns, and my husband and I flirt like young sweethearts.” — Cheryl",
    "“I'm mainly here for the food.” — Larry",
  ],
  whatToExpect: [
    "No partner needed. It's the custom in Rochester to change partners after each dance, so you'll dance with many different people over the evening. Come alone or with friends — you will be asked to dance, and you're welcome to sit out any dance you choose.",
    "What to wear: casual, comfortable clothes you can move in. Comfortable low or flat shoes — sneakers are fine; please avoid spike heels, which can damage the floor. Skip fragrance — some dancers have allergies.",
    "Dance roles: Rochester ECD tends to use traditional terminology (“men's line,” “women's line”), and uneven numbers of men and women are fine — everyone dances with everyone. Some callers are moving toward positional terms, another way to reduce gendered language.",
    "Getting started: arrive early for the free introductory lesson (6:10 pm, or 2:10 pm in winter), ask an experienced dancer to partner your first few dances, and don't worry about mistakes — everyone makes them. If you'd like to watch first, you're welcome to drop in at no charge.",
    "Good to know: alcohol- and smoke-free, and open to all ages and backgrounds. Kids are welcome, and non-dancing children may play quietly at the tables in the back. Refreshments are provided at the break.",
  ],
};

const COMMUNITY: StyleLanding = {
  slug: "community",
  seriesKey: SERIES_KEYS.cdob,
  title: "What is the community dance?",
  intro: [
    "The community dance is a family-friendly dance for all ages, held on the second Thursday of every month from 6:00 to 7:00 pm at Rosette Studio (downstairs at 295 Gregory St), right before the evening contra.",
    "These dances are simple, playful, and designed for everyone — no experience or partner needed. They're smoke- and alcohol-free.",
  ],
  whyYoullLove: [
    "Simple and playful — designed for all ages, from kids to grandparents.",
    "Live music from an open band led by Clara and Micah.",
    "Anyone can sit in with an acoustic instrument — musicians play free and are comp'd into the evening contra at 7:30.",
    "An easy, low-key way to try country dancing for the first time.",
  ],
  whatToExpect: [
    "No partner needed, and no experience either — every dance is simple and taught as you go.",
    "All ages welcome; families dance together. It's smoke- and alcohol-free.",
    "Parking is next door at the Historic German House (when there's no conflicting event), or on the street.",
    "Gender-free calling — the same welcoming “Larks” and “Robins” roles as the evening contra.",
    "Supported by a grant from the Country Dance and Song Society.",
  ],
};

export const LANDING_CONTENT: Record<string, StyleLanding> = {
  contra: CONTRA,
  english: ENGLISH,
  community: COMMUNITY,
};

/** The covered style slugs (drives `generateStaticParams`): contra, english, community. */
export const STYLE_SLUGS: string[] = Object.keys(LANDING_CONTENT);

/** The landing content for a style slug, or null when the slug is not a covered style. */
export function getStyleLanding(slug: string): StyleLanding | null {
  return LANDING_CONTENT[slug] ?? null;
}
