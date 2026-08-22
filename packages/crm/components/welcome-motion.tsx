'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function WelcomeMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();

    const context = gsap.context(() => {
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const heroCopy = root.querySelectorAll('[data-hero-copy] > *');
        const heroMedia = root.querySelector('[data-hero-media]');

        if (heroMedia) {
          gsap.from(heroMedia, {
            autoAlpha: 0,
            scale: 1.025,
            duration: 1.2,
            ease: 'power2.out',
          });

          gsap.to(heroMedia, {
            yPercent: -3,
            scale: 1.025,
            ease: 'none',
            scrollTrigger: {
              trigger: heroMedia,
              start: 'top top',
              end: 'bottom top',
              scrub: 0.8,
            },
          });
        }

        gsap.from(heroCopy, {
          autoAlpha: 0,
          y: 28,
          duration: 0.8,
          stagger: 0.09,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: heroCopy[0] ?? root,
            start: 'top 84%',
            toggleActions: 'play none none reverse',
          },
        });

        root.querySelectorAll<HTMLElement>('[data-depth-card]').forEach((card, index) => {
          gsap.fromTo(
            card,
            {
              autoAlpha: 0.92,
              y: 46,
              rotateX: index % 2 === 0 ? 5 : -4,
              rotateY: index % 2 === 0 ? -2.5 : 2.5,
              transformPerspective: 1200,
            },
            {
              autoAlpha: 1,
              y: 0,
              rotateX: 0,
              rotateY: 0,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: card,
                start: 'top 88%',
                end: 'top 58%',
                scrub: 0.7,
              },
            },
          );
        });

        root.querySelectorAll<HTMLElement>('[data-parallax-image]').forEach((image, index) => {
          gsap.fromTo(
            image,
            { yPercent: index % 2 === 0 ? -4 : -7, scale: 1.06 },
            {
              yPercent: index % 2 === 0 ? 4 : 7,
              scale: 1.01,
              ease: 'none',
              scrollTrigger: {
                trigger: image,
                start: 'top bottom',
                end: 'bottom top',
                scrub: 0.9,
              },
            },
          );
        });

        root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => {
          gsap.from(element, {
            autoAlpha: 0,
            y: 34,
            duration: 0.85,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: element,
              start: 'top 84%',
              toggleActions: 'play none none reverse',
            },
          });
        });

        const productFrame = root.querySelector('[data-product-frame]');
        if (productFrame) {
          gsap.fromTo(
            productFrame,
            { scale: 0.94, rotateX: 8, y: 70, transformPerspective: 1600 },
            {
              scale: 1,
              rotateX: 0,
              y: 0,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: productFrame,
                start: 'top 90%',
                end: 'top 46%',
                scrub: 0.8,
              },
            },
          );
        }
      });
    }, root);

    document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);

    return () => {
      media.revert();
      context.revert();
    };
  }, []);

  return (
    <div ref={rootRef} className={className} data-welcome-motion>
      {children}
    </div>
  );
}
