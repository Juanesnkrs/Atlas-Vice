// Sección «Contenido público» del panel de gestión (ADMIN+): Catálogo, Mapa interactivo, Módulos y Portada (Hero).
// Cascarón: cada gestor vive en su archivo (StaffCatalog, StaffMap, StaffModules, StaffHero).
import { CatalogManager } from './StaffCatalog';
import { HeroManager } from './StaffHero';
import { Block, SubTabs } from './StaffKit';
import { MapManager } from './StaffMap';
import { useBlockTab } from './StaffNav';
import { ModulesManager } from './StaffModules';

type Sub = 'catalogo' | 'mapa' | 'modulos' | 'hero';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'mapa', label: 'Mapa interactivo' },
  { id: 'modulos', label: 'Módulos' },
  { id: 'hero', label: 'Portada (Hero)' },
];

export default function StaffContent() {
  const [sub, setSub] = useBlockTab('contenido', SUBS);
  return (
    <div className="flex flex-col gap-4">
      <SubTabs label="Contenido público" tabs={SUBS} value={sub} onChange={setSub} />
      {sub === 'catalogo' && (
        <Block
          id="blk-catalogo"
          title="Catálogo por categorías"
          controls="las fichas de armas, vehículos, coleccionables, guías y mapa que se ven en el Catálogo y el Inspector."
          href="/catalogo"
          linkLabel="Abrir el catálogo"
        >
          <CatalogManager />
        </Block>
      )}
      {sub === 'mapa' && (
        <Block
          id="blk-mapa"
          title="Mapa interactivo"
          controls="los marcadores del mapa de Leonida: posición, región y ficha vinculada. Un marcador existente está publicado."
          href="/mapa"
          linkLabel="Abrir el mapa"
        >
          <MapManager />
        </Block>
      )}
      {sub === 'modulos' && (
        <Block
          id="blk-modulos"
          title="Módulos del catálogo"
          controls="qué secciones (Mapa, Foro) y categorías del catálogo se muestran en la navegación, en qué orden, y su nombre, icono y URL."
          href="/catalogo"
          linkLabel="Ver la navegación"
        >
          <ModulesManager />
        </Block>
      )}
      {sub === 'hero' && (
        <Block
          id="blk-hero"
          title="Portada (Hero)"
          controls="las diapositivas del carrusel de la portada: texto, botones, imagen, orden y cuáles se publican. Sin ninguna activa se muestra la diapositiva por defecto."
          href="/"
          linkLabel="Ver la portada"
        >
          <HeroManager />
        </Block>
      )}
    </div>
  );
}
