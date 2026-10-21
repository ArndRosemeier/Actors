/**
 * TSL nodes are typed loosely here: three's TSL types change between releases
 * and swizzles, chaining and Fn parameters fight the checker. The shader code
 * is checked where it runs (tests build every material; the viewer renders them).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;
