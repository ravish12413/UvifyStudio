
"use client";

import { useState, useMemo, useCallback, ChangeEvent, useRef, useEffect } from "react";
import Image from "next/image";
import { FileImage, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import Papa from "papaparse";
import QRCode from "qrcode";
import JSZip from "jszip";

const DPI = 300;
const cmToPx = (cm: number) => Math.round((cm / 2.54) * DPI);

type QrConfig = {
  qrSizeCm: number;
  marginTopCm: number;
  marginRightCm: number;
};

// Helper function to set DPI in JPEG blob
const setDpi = (blob: Blob, dpi: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          throw new Error("Could not read blob as ArrayBuffer");
        }
        const view = new DataView(arrayBuffer);
        const segments = [];
        let offset = 2; // Skip SOI

        while (offset < view.byteLength) {
            const marker = view.getUint16(offset);
            offset += 2;

            if (marker === 0xFFE0) { // APP0
                const len = view.getUint16(offset);
                // Skip this segment, we will replace it.
                offset += len;
                continue;
            }
            
            if (marker >= 0xFFD0 && marker <= 0xFFD9 || marker === 0xFF01) { // Markers without length
                continue;
            }

            if (marker === 0xFFDA) { // SOS
                segments.push(arrayBuffer.slice(offset - 2));
                break;
            }

            const len = view.getUint16(offset);
            if (len < 2) {
                // Invalid segment length
                break;
            }
            segments.push(arrayBuffer.slice(offset - 2, offset + len));
            offset += len;
        }
        
        // Create new APP0 segment for JFIF
        const app0Data = new Uint8Array(16);
        const app0View = new DataView(app0Data.buffer);
        app0View.setUint16(0, 0xFFE0); // APP0 marker
        app0View.setUint16(2, 16); // Length of segment
        app0View.setUint8(4, 0x4A); // J
        app0View.setUint8(5, 0x46); // F
        app0View.setUint8(6, 0x49); // I
        app0View.setUint8(7, 0x46); // F
        app0View.setUint8(8, 0x00); // \0
        app0View.setUint16(9, 0x0101); // Version 1.01
        app0View.setUint8(11, 1); // Units: 1 for DPI
        app0View.setUint16(12, dpi); // X density
        app0View.setUint16(14, dpi); // Y density

        const soi = new Uint8Array([0xFF, 0xD8]); // SOI marker
        const newBlobParts = [soi, app0Data, ...segments.map(s => new Uint8Array(s))];
        
        resolve(new Blob(newBlobParts, { type: 'image/jpeg' }));

      } catch(error) {
        console.error("Error setting DPI:", error);
        resolve(blob); // Fallback to original blob
      }
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      resolve(blob);
    };
    reader.readAsArrayBuffer(blob);
  });
};


export default function Home() {
  const [bgDimensions, setBgDimensions] = useState({ widthCm: 16, heightCm: 9 });
  const [qrConfig, setQrConfig] = useState<QrConfig>({ qrSizeCm: 3, marginTopCm: 2.4, marginRightCm: 0.9 });
  
  const [bgImage, setBgImage] = useState<{ file: File; url: string; width: number; height: number; } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [links, setLinks] = useState<Record<string, string>[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();
  const csvInputRef = useRef<HTMLInputElement>(null);

  const handleBgImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if(file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.onload = () => {
            setBgImage({ file, url, width: img.width, height: img.height });
        };
        img.src = url;
      } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid image file (JPG, PNG, etc.)." });
      }
    }
  };

  const handleCsvChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      setCsvFile(file);
      setLinks([]); 
      Papa.parse(file, {
        header: true,
        delimiter: ",",
        skipEmptyLines: true,
        transformHeader: header => header.trim(),
        complete: (results) => {
          if (!results.meta.fields?.includes("links")) {
            toast({ variant: "destructive", title: "Invalid CSV", description: "CSV must have a 'links' column." });
            setLinks([]);
            setCsvFile(null);
            if (csvInputRef.current) csvInputRef.current.value = "";
            return;
          }
          
          const parsedLinks = (results.data as Record<string, string>[])
            .map(row => (row.links && row.links.trim() ? { links: row.links.trim() } : null))
            .filter(Boolean) as Record<string, string>[];

          setLinks(parsedLinks);
          if (parsedLinks.length > 0) {
            toast({ title: "CSV Parsed", description: `Found ${parsedLinks.length} rows with links.` });
          } else {
            toast({ variant: "destructive", title: "No Links Found", description: "No valid data found in the 'links' column." });
          }
        },
        error: (error) => {
            toast({ variant: "destructive", title: "CSV Parsing Error", description: error.message });
            setLinks([]);
        }
      });
    } else {
      toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid CSV file." });
    }
  };
  
  const handleBgDimChange = (key: 'widthCm' | 'heightCm', value: number) => {
    const newBgDimensions = { ...bgDimensions, [key]: value || 0 };
    setBgDimensions(newBgDimensions);

    const newMaxTop = newBgDimensions.heightCm - qrConfig.qrSizeCm;
    const newMaxRight = newBgDimensions.widthCm - qrConfig.qrSizeCm;
    setQrConfig(prevConfig => ({
        ...prevConfig,
        marginTopCm: Math.min(prevConfig.marginTopCm, newMaxTop < 0 ? 0 : newMaxTop),
        marginRightCm: Math.min(prevConfig.marginRightCm, newMaxRight < 0 ? 0 : newMaxRight)
    }));
  };

  const handleQrConfigChange = (key: keyof QrConfig, value: number) => {
    setQrConfig(prev => ({ ...prev, [key]: value }));
  };

  const previewStyle = useMemo(() => {
    if (!bgImage) return {};

    const containerAspectRatio = bgDimensions.widthCm / bgDimensions.heightCm;
    const imageAspectRatio = bgImage.width / bgImage.height;

    let scaleFactor: number;
    let offsetXPercent = 0;
    let offsetYPercent = 0;
    let scaledWidthPercent: number;
    let scaledHeightPercent: number;
    
    if (imageAspectRatio > containerAspectRatio) {
        
        scaledWidthPercent = 100;
        scaledHeightPercent = (containerAspectRatio / imageAspectRatio) * 100;
        offsetYPercent = (100 - scaledHeightPercent) / 2;
    } else {
        
        scaledHeightPercent = 100;
        scaledWidthPercent = (imageAspectRatio / containerAspectRatio) * 100;
        offsetXPercent = (100 - scaledWidthPercent) / 2;
    }
    
    // Calculate QR position relative to the scaled image
    const qrSizePercent = (qrConfig.qrSizeCm / bgDimensions.widthCm) * scaledWidthPercent;
    const qrTopPercent = (qrConfig.marginTopCm / bgDimensions.heightCm) * scaledHeightPercent;
    const qrRightPercent = (qrConfig.marginRightCm / bgDimensions.widthCm) * scaledWidthPercent;

    return {
      position: 'absolute',
      top: `${offsetYPercent + qrTopPercent}%`,
      right: `${offsetXPercent + qrRightPercent}%`,
      width: `${qrSizePercent}%`,
      aspectRatio: '1 / 1'
    };

  }, [qrConfig, bgDimensions, bgImage]);

  const generateImages = useCallback(async () => {
  if (!bgImage || links.length === 0) {
    toast({
      variant: "destructive",
      title: "Missing Inputs",
      description: "Please upload a background image and a valid CSV with links.",
    });
    return;
  }

  setIsProcessing(true);
  setProgress(0);

  const outputWidthPx = cmToPx(bgDimensions.widthCm);
  const outputHeightPx = cmToPx(bgDimensions.heightCm);
  const qrSizePx = cmToPx(qrConfig.qrSizeCm);

  const bgImageElement = document.createElement("img");
  bgImageElement.src = bgImage.url;
  await new Promise(resolve => { bgImageElement.onload = resolve; });

  const canvasAspectRatio = outputWidthPx / outputHeightPx;
  const imageAspectRatio = bgImageElement.width / bgImageElement.height;
  let drawWidth, drawHeight, offsetX, offsetY;

  if (imageAspectRatio > canvasAspectRatio) {
    drawWidth = outputWidthPx;
    drawHeight = drawWidth / imageAspectRatio;
    offsetX = 0;
    offsetY = (outputHeightPx - drawHeight) / 2;
  } else {
    drawHeight = outputHeightPx;
    drawWidth = drawHeight * imageAspectRatio;
    offsetX = (outputWidthPx - drawWidth) / 2;
    offsetY = 0;
  }

  const BATCH_SIZE = 4;
  const IMAGES_PER_ZIP = 2000;

  const zipFiles: JSZip[] = [];
  const zipImageCounts: number[] = [];

  for (let i = 0; i < links.length; i += BATCH_SIZE) {
    const batch = links.slice(i, i + BATCH_SIZE);

    const blobs = await Promise.all(
      batch.map(async (entry, index) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        canvas.width = outputWidthPx;
        canvas.height = outputHeightPx;

        const link = entry.links;

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, outputWidthPx, outputHeightPx);
        ctx.drawImage(bgImageElement, offsetX, offsetY, drawWidth, drawHeight);

        const qrDataUrl = await QRCode.toDataURL(link, {
          errorCorrectionLevel: 'H',
          margin: 0,
          scale: 10,
          color: { light: '#FFFFFF00' }
        });

        const qrImageElement = document.createElement('img');
        qrImageElement.src = qrDataUrl;
        await new Promise(resolve => { qrImageElement.onload = resolve; });

        const pasteX = offsetX + drawWidth - qrSizePx - cmToPx(qrConfig.marginRightCm);
        const pasteY = offsetY + cmToPx(qrConfig.marginTopCm);

        ctx.fillStyle = "white";
        ctx.fillRect(pasteX, pasteY, qrSizePx, qrSizePx);
        ctx.drawImage(qrImageElement, pasteX, pasteY, qrSizePx, qrSizePx);

        const blob = await new Promise<Blob | null>(resolve =>
          canvas.toBlob(resolve, 'image/jpeg', 0.9)
        );

        if (blob) {
          return { blob: await setDpi(blob, DPI), link };
        }

        return null;
      })
    );

    // Save each image to its zip
    blobs.forEach((item, batchIndex) => {
      if (!item) return;
      const fullIndex = i + batchIndex;
      const { blob, link } = item;

      const zipIndex = Math.floor(fullIndex / IMAGES_PER_ZIP);
      if (!zipFiles[zipIndex]) {
        zipFiles[zipIndex] = new JSZip();
        zipImageCounts[zipIndex] = 0;
      }

      const query = link.split("?")[1];
      let fileName = "";

      if (query) {
        const params = new URLSearchParams(query);
        const lastParam = Array.from(params.values()).pop();
        fileName = lastParam?.replace(/[^a-zA-Z0-9_-]/g, "_") || "";
      }

      if (!fileName) {
        fileName = `qr_image_${String(fullIndex + 1).padStart(4, "0")}`;
      }

      zipFiles[zipIndex].file(`${fileName}.jpg`, blob);
      zipImageCounts[zipIndex]++;
    });

    setProgress(((i + BATCH_SIZE) / links.length) * 100);

    // Immediately flush any full zip(s)
    for (let z = 0; z < zipFiles.length; z++) {
      if (zipFiles[z] && zipImageCounts[z] === IMAGES_PER_ZIP) {
        const zipBlob = await zipFiles[z].generateAsync({ type: "blob" });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(zipBlob);
        a.download = `uvify_part${z + 1}.zip`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        zipFiles[z] = null as any; // mark flushed
        zipImageCounts[z] = 0;
      }
    }
  }

  // Final flush for any partial zips
  for (let z = 0; z < zipFiles.length; z++) {
    if (zipFiles[z]) {
      const zipBlob = await zipFiles[z].generateAsync({ type: "blob" });

      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `uvify_part${z + 1}.zip`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }
  }

  setIsProcessing(false);
  toast({
    title: "Success!",
    description: "All images and ZIP files have been generated and downloaded.",
  });
}, [bgImage, links, qrConfig, bgDimensions, toast]);



  const fileInputStyles = "file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer";

  const csvDescription = useMemo(() => {
    return `File must have column 'links'. Found ${links.length} row(s).`
  }, [links.length]);


  return (
    <div className="min-h-screen bg-background text-foreground font-body">
      <header className="py-6 px-8 border-b border-border shadow-sm bg-card">
        <h1 className="text-4xl font-bold font-headline text-primary">Uvify</h1>
        <p className="text-muted-foreground mt-1">A simple tool to batch-create QR codes on images.</p>
      </header>
      
      <main className="grid grid-cols-1 lg:grid-cols-5 gap-8 p-4 md:p-8">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">1</span>Upload Files</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div>
                 <Label htmlFor="bg-upload" className="mb-2 block">Background Image</Label>
                 <Input id="bg-upload" type="file" accept="image/*" onChange={handleBgImageChange} className={fileInputStyles}/>
               </div>
               <div>
                  <Label htmlFor="csv-upload" className="mb-2 block">Links CSV File</Label>
                  <CardDescription className="mb-2 text-xs">{csvDescription}</CardDescription>
                  <Input id="csv-upload" ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvChange} disabled={!bgImage} className={fileInputStyles}/>
               </div>
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">2</span>Configure Layout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bg-width">Image Width (cm)</Label>
                  <Input id="bg-width" type="number" value={bgDimensions.widthCm} onChange={e => handleBgDimChange('widthCm', +e.target.value)} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="bg-height">Image Height (cm)</Label>
                  <Input id="bg-height" type="number" value={bgDimensions.heightCm} onChange={e => handleBgDimChange('heightCm', +e.target.value)} />
                </div>
              </div>

              <div className="space-y-4">
                <Label>QR Size (cm): {qrConfig.qrSizeCm.toFixed(1)}</Label>
                <Slider value={[qrConfig.qrSizeCm]} onValueChange={([v]) => handleQrConfigChange('qrSizeCm', v)} min={1} max={Math.min(bgDimensions.widthCm, bgDimensions.heightCm)} step={0.1}/>
              </div>
              <div className="space-y-4">
                <Label>Top Margin (cm): {qrConfig.marginTopCm.toFixed(1)}</Label>
                <Slider value={[qrConfig.marginTopCm]} onValueChange={([v]) => handleQrConfigChange('marginTopCm', v)} min={0} max={bgDimensions.heightCm - qrConfig.qrSizeCm} step={0.1}/>
              </div>
              <div className="space-y-4">
                <Label>Right Margin (cm): {qrConfig.marginRightCm.toFixed(1)}</Label>
                <Slider value={[qrConfig.marginRightCm]} onValueChange={([v]) => handleQrConfigChange('marginRightCm', v)} min={0} max={bgDimensions.widthCm - qrConfig.qrSizeCm} step={0.1}/>
              </div>
            </CardContent>
          </Card>
          
          <div className="mt-auto pt-6 flex flex-col items-center">
            <Button size="lg" className="w-full text-lg font-bold" onClick={generateImages} disabled={!bgImage || links.length === 0 || isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin mr-2"/> : <Download className="mr-2"/>}
              {isProcessing ? `Processing...` : `Generate & Download Zip`}
            </Button>
            {isProcessing && <div className="w-full text-center mt-2">
              <Progress value={progress} className="w-full h-3" />
              <p className="text-sm text-muted-foreground mt-1">{Math.round(progress)}% Complete</p>
            </div>}
          </div>
        </div>

        <div className="lg:col-span-3">
          <Card className="sticky top-8 shadow-lg">
             <CardHeader>
                <CardTitle>Live Preview</CardTitle>
                <CardDescription>A representation of your final image layout. The QR code will be placed relative to the background image content, which will be centered and scaled to fit.</CardDescription>
             </CardHeader>
             <CardContent>
               <div className="aspect-video bg-muted/50 rounded-lg flex items-center justify-center relative overflow-hidden border" style={{ aspectRatio: `${bgDimensions.widthCm} / ${bgDimensions.heightCm}` }}>
                {bgImage ? (
                  <>
                    <Image src={bgImage.url} alt="Background Preview" fill className="object-contain" />
                    <div 
                      className="bg-primary/50 border-2 border-dashed border-accent"
                      style={previewStyle}
                    >
                      <div className="w-full h-full flex items-center justify-center">
                        <p className="text-white text-xs font-bold bg-black/50 px-2 py-1 rounded-sm">QR</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center text-muted-foreground p-8">
                    <FileImage className="mx-auto h-16 w-16 opacity-50"/>
                    <p className="mt-4 font-medium">Upload a background image to see the preview</p>
                  </div>
                )}
               </div>
             </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
