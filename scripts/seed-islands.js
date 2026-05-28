#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { ConvexHttpClient } = require("convex/browser");
const { api }              = require("../convex/_generated/api-node.js");

const ISLANDS = [
  {
    slug:    "tenerife",
    name:    "Tenerife",
    intro:   "Tenerife, la isla mayor del archipiélago, alberga el Teide —el volcán más alto de España— y una riquísima biodiversidad que la convierte en un laboratorio natural excepcional para la educación.",
    nature:  "Con bosques de laurisilva declarados Patrimonio de la Humanidad, barrancos profundos y el Parque Nacional del Teide, Tenerife ofrece contextos únicos para el estudio de la geología, la botánica y la ecología insular.",
    culture: "Las tradiciones tinerfeñas —desde el carnaval más famoso del mundo hasta la lucha canaria y el silbo gomero— son una puerta de entrada a la historia y la identidad del archipiélago.",
  },
  {
    slug:    "gran-canaria",
    name:    "Gran Canaria",
    intro:   "Gran Canaria, conocida como un 'continente en miniatura', concentra una diversidad de paisajes y ecosistemas en pocos kilómetros que la hacen ideal para proyectos educativos interdisciplinares.",
    nature:  "Del litoral de dunas de Maspalomas a las cumbres de Tejeda, la variedad climática y geológica de Gran Canaria permite trabajar ciclos del agua, erosión, biodiversidad y cambio climático.",
    culture: "Cuna de la música y la artesanía canaria, la isla conserva yacimientos aborígenes únicos y una gastronomía arraigada en el territorio que nutre múltiples áreas curriculares.",
  },
  {
    slug:    "lanzarote",
    name:    "Lanzarote",
    intro:   "Lanzarote, Reserva de la Biosfera de la UNESCO, es un mosaico de paisajes volcánicos, viñedos en jable y costa atlántica que inspira a artistas y científicos por igual.",
    nature:  "Los Jameos del Agua, el Parque Nacional de Timanfaya y los túneles volcánicos ofrecen escenarios inigualables para el estudio de la vulcanología, la biología extremófila y la geología.",
    culture: "El legado de César Manrique, la arquitectura vernácula integrada en el paisaje y las bodegas enterradas en el jable definen una identidad cultural profundamente ligada al medio natural.",
  },
  {
    slug:    "fuerteventura",
    name:    "Fuerteventura",
    intro:   "Fuerteventura, la isla más antigua y la más africana del archipiélago, destaca por sus extensas playas, sus dunas protegidas y una historia ligada a los aborígenes mahos.",
    nature:  "Las extensas playas, las dunas de Corralejo y el Parque Natural de Jandía son perfectos para trabajar la sedimentología, los ecosistemas costeros y la adaptación a la aridez.",
    culture: "La cultura majorera —el queso, la artesanía de palma y la historia de los mahos— ofrece un hilo conductor para proyectos de patrimonio, lengua y valores ambientales.",
  },
  {
    slug:    "la-palma",
    name:    "La Palma",
    intro:   "La Palma, 'la Isla Bonita', combina la riqueza de sus bosques con la modernidad de su astrofísica, un binomio singular entre naturaleza y ciencia que abre infinitas posibilidades educativas.",
    nature:  "La Caldera de Taburiente, los pinos canarios centenarios y el reciente volcán de Tajogaite convierten la isla en un aula de geología e historia natural a cielo abierto.",
    culture: "Los miradores del cielo nocturno, la seda artesanal y las fiestas del Pino y los Indianos conforman un patrimonio cultural de gran valor para trabajar la identidad y la interculturalidad.",
  },
  {
    slug:    "la-gomera",
    name:    "La Gomera",
    intro:   "La Gomera guarda uno de los bosques de laurisilva más densos del planeta y el silbo gomero, el único lenguaje silbado del mundo reconocido por la UNESCO.",
    nature:  "El Parque Nacional de Garajonay, con su niebla permanente y su biodiversidad endémica, es un ejemplo excepcional de ecosistema relicto para el estudio de la biogeografía y la conservación.",
    culture: "El silbo gomero, las danzas y la alfarería sin torno son expresiones de una cultura aborigen que pervive y que ofrece proyectos interdisciplinares en lengua, música y ciencias sociales.",
  },
  {
    slug:    "el-hierro",
    name:    "El Hierro",
    intro:   "El Hierro, la isla más pequeña y occidental del archipiélago, es también la primera isla del mundo autosuficiente en energía renovable, un modelo de sostenibilidad para el siglo XXI.",
    nature:  "El paisaje lunar del volcán y el mar de Las Calmas —hogar del lagarto gigante— hacen de El Hierro un referente para proyectos de sostenibilidad, energías renovables y biodiversidad endémica.",
    culture: "La cultura 'bimbache', la artesanía del junco y la siembra por voleo definen una comunidad que ha sabido preservar sus tradiciones a la vez que lidera la transición energética.",
  },
];

async function main() {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("Falta CONVEX_URL en .env.local");
    process.exit(1);
  }

  const convex = new ConvexHttpClient(convexUrl);

  console.log("Cargando datos de las 7 islas…");

  for (const island of ISLANDS) {
    try {
      await convex.mutation(api.islandPages.upsert, island);
      console.log(`  ✓ ${island.name}`);
    } catch (err) {
      console.error(`  ✗ ${island.name}: ${err.message}`);
    }
  }

  console.log("¡Listo!");
}

main();
