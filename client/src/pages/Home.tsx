import React from 'react';
import Header from '@/components/Header';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import TestModules from '@/components/TestModules';
import Stats from '@/components/Stats';
import Testimonials from '@/components/Testimonials';
import CallToAction from '@/components/CallToAction';
import Footer from '@/components/Footer';

export default function Home() {
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <Hero />
        <Stats />
        <Features />
        <TestModules />
        <Testimonials />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}