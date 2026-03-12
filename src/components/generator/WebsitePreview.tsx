import { GeneratedContent } from '@/types/generatedContent';
import { BusinessFormData } from '@/types/businessForm';
import { Mail, Phone, MapPin, Star, ArrowRight, CheckCircle } from 'lucide-react';

interface Props {
  content: GeneratedContent;
  formData: BusinessFormData;
}

export function WebsitePreview({ content, formData }: Props) {
  const primary = formData.primaryColor;
  const secondary = formData.secondaryColor;

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-background">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-destructive/60" />
          <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
          <div className="h-3 w-3 rounded-full bg-success/60" />
        </div>
        <div className="flex-1 text-center text-xs text-muted-foreground font-mono">
          {formData.businessName.toLowerCase().replace(/\s+/g, '')}.com
        </div>
      </div>

      {/* Website content */}
      <div className="max-h-[600px] overflow-y-auto">
        {/* Hero */}
        <section
          className="relative px-8 py-20 text-center"
          style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
        >
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-primary-foreground mb-4 leading-tight">
            {content.heroHeadline}
          </h1>
          <p className="text-lg text-primary-foreground/80 max-w-2xl mx-auto mb-8">
            {content.heroSubheadline}
          </p>
          <button
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.95)', color: primary }}
          >
            {content.ctaButtonText} <ArrowRight className="h-4 w-4" />
          </button>
        </section>

        {/* About */}
        <section className="px-8 py-16">
          <h2 className="text-2xl font-display font-bold text-foreground mb-4">{content.aboutTitle}</h2>
          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{content.aboutContent}</p>
        </section>

        {/* Services */}
        <section className="px-8 py-16 bg-muted/30">
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">Our Services</h2>
          <p className="text-muted-foreground mb-8">{content.servicesIntro}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.services.map((svc, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-5">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center mb-3 text-sm font-bold"
                  style={{ background: `${primary}20`, color: primary }}
                >
                  {i + 1}
                </div>
                <h3 className="font-semibold text-foreground mb-1">{svc.name}</h3>
                <p className="text-sm text-muted-foreground">{svc.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Benefits */}
        <section className="px-8 py-16">
          <h2 className="text-2xl font-display font-bold text-foreground mb-8 text-center">Why Choose Us</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {content.benefits.map((b, i) => (
              <div key={i} className="text-center">
                <CheckCircle className="h-8 w-8 mx-auto mb-3" style={{ color: primary }} />
                <h3 className="font-semibold text-foreground mb-1">{b.title}</h3>
                <p className="text-sm text-muted-foreground">{b.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Testimonials */}
        <section className="px-8 py-16 bg-muted/30">
          <h2 className="text-2xl font-display font-bold text-foreground mb-8 text-center">What Our Clients Say</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {content.testimonials.map((t, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-5">
                <div className="flex gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                  ))}
                </div>
                <p className="text-sm text-foreground/80 italic mb-4">"{t.quote}"</p>
                <div>
                  <div className="text-sm font-semibold text-foreground">{t.author}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section
          className="px-8 py-16 text-center"
          style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
        >
          <h2 className="text-2xl font-display font-bold text-primary-foreground mb-2">{content.ctaHeadline}</h2>
          <p className="text-primary-foreground/80 mb-6">{content.ctaSubtext}</p>
          <button
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-sm"
            style={{ background: 'rgba(255,255,255,0.95)', color: primary }}
          >
            {content.ctaButtonText} <ArrowRight className="h-4 w-4" />
          </button>
        </section>

        {/* Contact / Footer */}
        <footer className="px-8 py-12 border-t border-border">
          <div className="grid sm:grid-cols-3 gap-6 text-sm">
            <div>
              <h3 className="font-display font-bold text-foreground mb-2">{formData.businessName}</h3>
              <p className="text-muted-foreground text-xs">{formData.businessDescription.slice(0, 120)}...</p>
            </div>
            <div className="space-y-2">
              {formData.email && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" /> {formData.email}
                </div>
              )}
              {formData.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" /> {formData.phone}
                </div>
              )}
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 mt-0.5" />
              <span>{formData.city}, {formData.country}</span>
            </div>
          </div>
          <div className="mt-8 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} {formData.businessName}. All rights reserved.
          </div>
        </footer>
      </div>
    </div>
  );
}
