import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Passforth | Next for you',description:'Saved requests, confirmed progress, and your next step.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
