import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  return { neuronClass: decodeURIComponent(params.class) };
};

export const ssr = false;
export const prerender = false;
