import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BusinessFormData, CourseItem } from '@/types/businessForm';
import { Plus, X, GraduationCap } from 'lucide-react';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

const emptyCourse: CourseItem = { title: '', instructor: '', description: '', modules: '', price: '' };

export function StepCourses({ data, onChange }: Props) {
  const courses = data.courses.length > 0 ? data.courses : [{ ...emptyCourse }];

  const update = (i: number, field: keyof CourseItem, value: string) => {
    const updated = [...courses];
    updated[i] = { ...updated[i], [field]: value };
    onChange({ courses: updated });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Courses</h3>
        <p className="form-section-desc">Add the courses for your platform</p>
      </div>

      {courses.map((c, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Course {i + 1}</span>
            </div>
            {courses.length > 1 && (
              <Button variant="ghost" size="icon" onClick={() => onChange({ courses: courses.filter((_, idx) => idx !== i) })} className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Course Title *</Label>
              <Input value={c.title} onChange={e => update(i, 'title', e.target.value)} placeholder="Course title" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Instructor</Label>
              <Input value={c.instructor} onChange={e => update(i, 'instructor', e.target.value)} placeholder="Instructor name" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Price</Label>
              <Input value={c.price} onChange={e => update(i, 'price', e.target.value)} placeholder="$199" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea value={c.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Course description" rows={2} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Modules (one per line)</Label>
              <Textarea value={c.modules} onChange={e => update(i, 'modules', e.target.value)} placeholder="Module 1: Introduction&#10;Module 2: Basics" rows={3} className="mt-1" />
            </div>
          </div>
        </div>
      ))}

      <Button variant="outline" onClick={() => onChange({ courses: [...courses, { ...emptyCourse }] })} className="gap-1 w-full">
        <Plus className="h-4 w-4" /> Add Course
      </Button>
    </div>
  );
}
