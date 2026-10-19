/**
 * Scripted conversations for the hero phone. Everything here is made up for illustration (the page says so):
 * brands, products, ratings, prices and the order number are not real.
 */

export interface DemoProduct {
  brand: string;
  name: string;
  rating: string;
  reviews: string;
  delivery: string;
  price: string;
  /** CSS background for the placeholder thumbnail until real product photos are supplied. */
  gradient: string;
}

export interface DemoSearch {
  assistant: "ChatGPT" | "Gemini" | "Claude";
  query: string;
  matched: string;
  intro: string;
  products: [DemoProduct, DemoProduct, DemoProduct];
  /** Index of the product the shopper chooses. */
  pick: 0 | 1 | 2;
  arrives: string;
}

export const DEMO_ORDER_NUMBER = "#BS-2481";

export const DEMO_SEARCHES: DemoSearch[] = [
  {
    assistant: "ChatGPT",
    query: "warm hoodie for gifting under ₹2,500",
    matched: "3 brands matched",
    intro: "Top picks from different brands:",
    pick: 0,
    arrives: "by Friday",
    products: [
      { brand: "Heritage", name: "Wool Hoodie", rating: "4.8", reviews: "212", delivery: "Free delivery", price: "₹2,199", gradient: "linear-gradient(135deg,#f59e0b,#92400e)" },
      { brand: "Northwind", name: "Fleece Zip Hoodie", rating: "4.5", reviews: "128", delivery: "2-day delivery", price: "₹1,799", gradient: "linear-gradient(135deg,#60a5fa,#1e3a8a)" },
      { brand: "Thread & Co", name: "Merino Gift Hoodie", rating: "4.9", reviews: "64", delivery: "Free delivery", price: "₹2,450", gradient: "linear-gradient(135deg,#a78bfa,#4c1d95)" },
    ],
  },
  {
    assistant: "Gemini",
    query: "cold-pressed groundnut oil 5L",
    matched: "3 brands matched",
    intro: "Top picks from different brands:",
    pick: 1,
    arrives: "in 2 days",
    products: [
      { brand: "Kachi Co.", name: "Groundnut Oil 5L", rating: "4.6", reviews: "402", delivery: "Free delivery", price: "₹1,299", gradient: "linear-gradient(135deg,#fbbf24,#b45309)" },
      { brand: "Gaon Farms", name: "Cold-pressed Oil 5L", rating: "4.8", reviews: "318", delivery: "Ships in 24h", price: "₹1,150", gradient: "linear-gradient(135deg,#a3e635,#4d7c0f)" },
      { brand: "Wood Press", name: "Wood-pressed Oil 5L", rating: "4.7", reviews: "190", delivery: "Free delivery", price: "₹1,420", gradient: "linear-gradient(135deg,#d6a35c,#7c4a1d)" },
    ],
  },
  {
    assistant: "Claude",
    query: "handwoven cotton saree for a wedding gift",
    matched: "3 brands matched",
    intro: "Top picks from different brands:",
    pick: 2,
    arrives: "by Saturday",
    products: [
      { brand: "Looms of Kutch", name: "Handwoven Saree", rating: "4.7", reviews: "88", delivery: "Free delivery", price: "₹3,200", gradient: "linear-gradient(135deg,#34d399,#065f46)" },
      { brand: "Anaya Weaves", name: "Handloom Saree", rating: "4.8", reviews: "141", delivery: "Gift wrap", price: "₹3,980", gradient: "linear-gradient(135deg,#fb923c,#9a3412)" },
      { brand: "Kora Studio", name: "Cotton Saree", rating: "4.9", reviews: "96", delivery: "Gift wrap", price: "₹3,650", gradient: "linear-gradient(135deg,#f472b6,#9d174d)" },
    ],
  },
];

/** Search by tab index; wraps so a stale index can never read past the end. */
export function searchAt(i: number): DemoSearch {
  return DEMO_SEARCHES[i % DEMO_SEARCHES.length] as DemoSearch;
}
