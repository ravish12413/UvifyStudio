"use client";

import { useState, useMemo, useCallback, ChangeEvent } from "react";
import Image from "next/image";
import { FileImage, FileText, Settings, Download, Loader2 } from "lucide-react";
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

type QrSettings = {
  bgWidthCm: number;
  bgHeightCm: number;
  qrSizeCm: number;
  marginTopCm: number;
  marginRightCm: number;
};

export default function Home() {
  const [settings, setSettings] = useState<QrSettings>({
    bgWidthCm: 16,
    bgHeightCm: 9,
    qrSizeCm: 3,
    marginTopCm: 2.4,
    marginRightCm: 0.9,
  });
  const [bgImage, setBgImage] = useState<{ file: File; url: string } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const handleBgImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if(file.type.startsWith('image/')) {
        setBgImage({ file, url: URL.createObjectURL(file) });
      } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid image file (JPG, PNG, etc.)." });
      }
    }
  };

  const handleCsvChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if(file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setCsvFile(file);
        Papa.parse<{ links: string }>(file, {
          header: true,
          skipEmptyLines: true,
          delimiter: ",",
          complete: (results) => {
            if (results.errors.length > 0) {
              toast({ variant: "destructive", title: "CSV Parsing Error", description: results.errors[0].message });
              setLinks([]);
              return;
            }
            if (!results.meta.fields?.includes("links")) {
              toast({ variant: "destructive", title: "Invalid CSV", description: "CSV file must contain a 'links' column." });
              setLinks([]);
              setCsvFile(null);
              return;
            }
            const parsedLinks = results.data.map(row => row.links?.trim()).filter(Boolean);
            setLinks(parsedLinks);
            if (parsedLinks.length > 0) {
              toast({ title: "CSV Parsed", description: `Found ${parsedLinks.length} links.` });
            } else {
              toast({ variant: "destructive", title: "No Links Found", description: "The 'links' column in your CSV is empty." });
            }
          },
        });
      } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid CSV file." });
      }
    }
  };
  
  const handleSettingsChange = (key: keyof QrSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const previewStyle = useMemo(() => {
    if (!bgImage) return {};
    const qrWidthPercent = (settings.qrSizeCm / settings.bgWidthCm) * 100;
    const qrTopPercent = (settings.marginTopCm / settings.bgHeightCm) * 100;
    const qrRightPercent = (settings.marginRightCm / settings.bgWidthCm) * 100;

    return {
      top: `${qrTopPercent}%`,
      right: `${qrRightPercent}%`,
      width: `${qrWidthPercent}%`,
    };
  }, [settings, bgImage]);

  const generateImages = useCallback(async () => {
    if (!bgImage || links.length === 0) {
      toast({ variant: "destructive", title: "Missing Inputs", description: "Please upload a background image and a valid CSV with links." });
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    const zip = new JSZip();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast({ variant: "destructive", title: "Error", description: "Could not create a canvas context." });
      setIsProcessing(false);
      return;
    }
    
    const outputWidthPx = cmToPx(settings.bgWidthCm);
    const outputHeightPx = cmToPx(settings.bgHeightCm);
    canvas.width = outputWidthPx;
    canvas.height = outputHeightPx;

    const bgImageElement = document.createElement('img');
    bgImageElement.src = bgImage.url;
    await new Promise(resolve => { bgImageElement.onload = resolve; });

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      
      ctx.drawImage(bgImageElement, 0, 0, outputWidthPx, outputHeightPx);
      
      const qrDataUrl = await QRCode.toDataURL(link, { 
        errorCorrectionLevel: 'H', 
        margin: 0,
        scale: 10, // A higher scale gives better quality for resizing
        color: { light: '#FFFFFF00' } // Transparent background
      });

      const qrImageElement = document.createElement('img');
      qrImageElement.src = qrDataUrl;
      await new Promise(resolve => { qrImageElement.onload = resolve; });

      const qrSizePx = cmToPx(settings.qrSizeCm);
      const pasteX = outputWidthPx - qrSizePx - cmToPx(settings.marginRightCm);
      const pasteY = cmToPx(settings.marginTopCm);
      
      // Add a white background behind the QR code for readability
      ctx.fillStyle = "white";
      ctx.fillRect(pasteX, pasteY, qrSizePx, qrSizePx);
      ctx.drawImage(qrImageElement, pasteX, pasteY, qrSizePx, qrSizePx);
      
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) {
        zip.file(`qr_image_${i + 1}.jpg`, blob);
      }
      
      setProgress(((i + 1) / links.length) * 100);
    }
    
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "uvify_outputs.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    
    setIsProcessing(false);
    toast({ title: "Success!", description: "Your images have been generated and downloaded." });
  }, [bgImage, links, settings, toast]);

  const fileInputStyles = "file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer";

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
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">1</span>Upload Background</CardTitle>
            </CardHeader>
            <CardContent>
              <Input id="bg-upload" type="file" accept="image/*" onChange={handleBgImageChange} className={fileInputStyles}/>
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">2</span>Upload CSV</CardTitle>
              <CardDescription>File must have a column named 'links'. Found {links.length} link(s).</CardDescription>
            </CardHeader>
            <CardContent>
              <Input id="csv-upload" type="file" accept=".csv,text/csv" onChange={handleCsvChange} disabled={!bgImage} className={fileInputStyles}/>
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">3</span>Configure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bg-width">Width (cm)</Label>
                  <Input id="bg-width" type="number" value={settings.bgWidthCm} onChange={e => handleSettingsChange('bgWidthCm', +e.target.value)} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="bg-height">Height (cm)</Label>
                  <Input id="bg-height" type="number" value={settings.bgHeightCm} onChange={e => handleSettingsChange('bgHeightCm', +e.target.value)} />
                </div>
              </div>
               <div className="space-y-4">
                  <Label>QR Size (cm): {settings.qrSizeCm.toFixed(1)}</Label>
                  <Slider value={[settings.qrSizeCm]} onValueChange={([v]) => handleSettingsChange('qrSizeCm', v)} min={1} max={Math.min(settings.bgWidthCm, settings.bgHeightCm)} step={0.1}/>
               </div>
               <div className="space-y-4">
                  <Label>Top Margin (cm): {settings.marginTopCm.toFixed(1)}</Label>
                  <Slider value={[settings.marginTopCm]} onValueChange={([v]) => handleSettingsChange('marginTopCm', v)} min={0} max={settings.bgHeightCm - settings.qrSizeCm} step={0.1}/>
               </div>
               <div className="space-y-4">
                  <Label>Right Margin (cm): {settings.marginRightCm.toFixed(1)}</Label>
                  <Slider value={[settings.marginRightCm]} onValueChange={([v]) => handleSettingsChange('marginRightCm', v)} min={0} max={settings.bgWidthCm - settings.qrSizeCm} step={0.1}/>
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
                <CardDescription>A representation of your final image layout.</CardDescription>
             </CardHeader>
             <CardContent>
               <div className="aspect-video bg-muted/50 rounded-lg flex items-center justify-center relative overflow-hidden border">
                {bgImage ? (
                  <>
                    <Image src={bgImage.url} alt="Background Preview" fill className="object-contain" />
                    <div 
                      className="absolute bg-primary/50 border-2 border-dashed border-accent"
                      style={{...previewStyle, aspectRatio: '1 / 1'}}
                    >
                      <div className="w-full h-full flex items-center justify-center">
                        <p className="text-white text-xs font-bold bg-black/50 px-2 py-1 rounded-full">QR</p>
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
