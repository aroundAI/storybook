'use client';

import type { UseFormReturn } from 'react-hook-form';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import type { CharacterFormData } from './character-editor';

interface CharacterPhysicalAttributesProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterPhysicalAttributes({
  form,
}: CharacterPhysicalAttributesProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Age */}
      <FormField
        control={form.control}
        name="physicalAttributes.age"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Age</FormLabel>
            <FormControl>
              <Input placeholder="e.g., 25" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Gender */}
      <FormField
        control={form.control}
        name="physicalAttributes.gender"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Gender</FormLabel>
            <Select onValueChange={field.onChange} value={field.value || ''}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="non-binary">Non-binary</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Height */}
      <FormField
        control={form.control}
        name="physicalAttributes.height"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Height</FormLabel>
            <FormControl>
              <Input placeholder="e.g., 5'10 or 180cm" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Build */}
      <FormField
        control={form.control}
        name="physicalAttributes.build"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Build</FormLabel>
            <Select onValueChange={field.onChange} value={field.value || ''}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select build" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="slim">Slim</SelectItem>
                <SelectItem value="athletic">Athletic</SelectItem>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="heavy">Heavy</SelectItem>
                <SelectItem value="muscular">Muscular</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Hair Color */}
      <FormField
        control={form.control}
        name="physicalAttributes.hairColor"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Hair Color</FormLabel>
            <FormControl>
              <Input placeholder="e.g., Black, Blonde" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Eye Color */}
      <FormField
        control={form.control}
        name="physicalAttributes.eyeColor"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Eye Color</FormLabel>
            <FormControl>
              <Input placeholder="e.g., Brown, Blue" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Distinctive Features */}
      <div className="col-span-full">
        <FormField
          control={form.control}
          name="physicalAttributes.distinctiveFeatures"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Distinctive Features</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Scar above left eyebrow, birthmark"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
