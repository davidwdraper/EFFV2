NV Design Concepts (many are currently implemented)

1. All domain data lives in a DTO - no excetion.
2. A DTO has an immutable ID that is created by the underlying DB if the DTO represents a DB record, otherwise it's a code generated UUID.
3. Every DTO inherits from DtoBase and also exposes an interface (IDto) <- new.
4. The IDto interface exposes those methods that the infrascture (plumbing) operate on for data flow. They are, but necessarily limited to:
   - getId():string (always; it never exposes or contains the type of the underlying DB store)
   - fromJson() This method checks for an id:string and throws if not found, and optionally validates data.
   - toJson() this method always includes the id as string
   - patch(dto:IDto) takes in a DTO and then field by field patches 'this'. The id is never touched. This method is required by a DbWriter for doing update logic, when an existing DTO updates a DTO that has been read from the DB, patched, and written back.
5. The concrete DTO is responsible for getters and setters for all the public properties (fields).
6. The DTO is not the object that is passed around within a service or outside of its edges. See next point.
7. All DTOs live in a DtoBag. A DtoBag holds zero or more DTOs.
8. A DtoBag also exposes a toJason() and fromJason() for data transfer at the edges.
9. The DtoBag is nothing but a DTO container and when its toJson() is called, it iterates through its collection, calling each contained DTO's toJason().
10. A DtoBag does not know a DTO's type, just the DTO interface (IDto)
11. A single DtoBag can contain different DTO types - think different flutter meta-data for different UI widgets, or a DtoBag containing all the DTOs that represent an Event, without have to create a composite object, or have the frontend call the backend multiple times.
12. When a dtoBag.fromJson() is called, the DtoBag's logic uses a factory pattern to instantiate the correct DTO type, for each dto json within the inbound array of json objects.
13. The DbReader can do either readOne(id:string) or readMany(filterList). In either case, the output is a DtoBag for consistency. If the entire backend is designed around the DtoBag, there is no confusion on whether its a single DTO interface, or many - it won't matter, it's always a bag.
14. readOne() and readMany() id's and filters do not use types other than string. The DbReader must convert to the types expected by the DB. DbWriter must always convert DB \_id's (ObjectId) to string, and normalize any other types for internal consumption (dates, etc.) This is done before calling the DTO's fromJson().
15. There is to be no fallbacks or multi-runtime coercion attempts to get a value. Strict typing always.

The immediate impact on the existing t_entity_crud service will be:

- removal of xxxId. It will become just 'id', and it's context is known by the dto it's bound to.
- DbWriter and DbReader to ensure they're following the design guidance layed out. DtoBag will need some work. It's new fromJson() needs to instantiate DTO objects.

Don't start writing code. Lets discuss approach, and I want to hear your thoughts and concerns.
