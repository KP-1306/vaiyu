import { useEffect } from 'react';

type Props = {
  title?: string;
  description?: string;
  noIndex?: boolean;
};

/**
 * Minimal SEO helper. Sets document title and a few common meta tags.
 * Returns null and never throws, so it's safe everywhere.
 */
export default function SEO({ title, description, noIndex }: Props) {
  useEffect(() => {
    if (title) document.title = title;

    if (description) {
      let tag = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement('meta');
        tag.name = 'description';
        document.head.appendChild(tag);
      }
      tag.content = description;
    }

    if (noIndex) {
      let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
      if (!robots) {
        robots = document.createElement('meta');
        robots.name = 'robots';
        document.head.appendChild(robots);
      }
      robots.content = 'noindex';
    }
  }, [title, description, noIndex]);

  return null;
}
